/* flashcard.js — Flashcard (AT45DB081B DataFlash) lesen/schreiben über WebSerial.
 *
 * Protokoll (verifiziert per USB-Mitschnitt + direktem COM-Zugriff, docs/02):
 *   Port 115200 8N1. Rahmen: 55 <Typ> … <chk=Σ ab 0x55 mod256>. Antwort beginnt mit 06=ACK.
 *   Init:        55 4C 00 00 A1                         -> 06 15 10 01 03 29 (Version/ID)
 *   Block lesen: 55 72 00 08 01 08 E8 00 <AdrLE16> 00 00 00 00 <chk> -> 06 <264 Datenbytes> <chk>
 *   Block schr.: 55 72 01 0C 00 00 82 00 <AdrLE16> <264 Datenbytes> <chk> -> 06
 *   Adresse +2 je Block (264 B contiguous). **Maschinen-Config liegt ab Adresse 2** (8192-B .dat,
 *   32 Blöcke). Adresse 0 = Service-/Flag-Karte (hier NICHT angetastet).
 *
 * Nicht-blockierend: alles async (WebSerial), Fortschritt per onProgress(done,total).
 */
const FlashCard = (function () {
  const BLK = 264;            // Datenbytes pro Block
  const CFG_ADDR0 = 2;        // Startadresse der Maschinen-Config
  const CFG_SIZE = 8192;      // .dat-Größe
  let port = null, reader = null, writer = null, readLoopDone = null, rx = [];
  const listeners = { log: [], status: [] };
  const supported = () => 'serial' in navigator;
  const emit = (ev, x) => listeners[ev] && listeners[ev].forEach(fn => { try { fn(x); } catch (e) {} });
  const on = (ev, fn) => { if (listeners[ev]) listeners[ev].push(fn); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hex = a => Array.from(a).map(b => b.toString(16).padStart(2, '0')).join(' ');

  async function connect({ reuse = true } = {}) {
    if (!supported()) throw new Error('Web Serial nicht verfügbar — Chrome/Edge/Firefox 151+ am Desktop.');
    port = null;
    if (reuse) { try { const ps = await navigator.serial.getPorts(); port = ps.find(p => { const i = p.getInfo ? p.getInfo() : {}; return i.usbVendorId === 0x0403; }) || ps[0] || null; } catch (e) {} }
    if (!port) port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0403 }] });
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    writer = port.writable.getWriter();
    startReader();
    await sleep(150);
    const r = await init();
    emit('status', { connected: true, id: r });
    return { connected: true, id: r };
  }
  function startReader() {
    reader = port.readable.getReader();
    readLoopDone = (async () => { try { while (true) { const { value, done } = await reader.read(); if (done) break; if (value) for (const b of value) rx.push(b); } } catch (e) {} })();
  }
  function frame(bytes) { const b = bytes.slice(); let s = 0; for (const x of b) s = (s + x) & 0xff; b.push(s); return Uint8Array.from(b); }

  // senden, Antwort bis 'want' vollständig (oder Timeout) einsammeln
  async function tx(fr, want, total = 2000) {
    rx = []; emit('log', { dir: 'tx', hex: hex(fr) });
    await writer.write(fr);
    const t0 = Date.now();
    while (Date.now() - t0 < total) { await sleep(8); if (want(rx)) break; }
    await sleep(20);
    const resp = rx.slice(); emit('log', { dir: 'rx', hex: hex(resp.slice(0, 8)) + (resp.length > 8 ? ` …(${resp.length} B)` : '') });
    return resp;
  }
  const wantAck = r => r.length >= 1 && r[0] === 0x06;
  const wantBlk = r => r.length >= 2 + BLK + 1 && r[0] === 0x06;

  async function init() {
    const r = await tx(frame([0x55, 0x4C, 0x00, 0x00]), r => r.length >= 6);
    if (!(r.length >= 1 && r[0] === 0x06)) throw new Error('Keine Antwort vom Programmer (Init).');
    return hex(r.slice(1));
  }
  function readCmd(addr) { return frame([0x55, 0x72, 0x00, 0x08, 0x01, 0x08, 0xE8, 0x00, addr & 0xff, (addr >> 8) & 0xff, 0, 0, 0, 0]); }
  async function readBlock(addr) {
    const r = await tx(readCmd(addr), wantBlk);
    if (!(r.length >= 2 + BLK && r[0] === 0x06)) throw new Error(`Block @${addr} lesen fehlgeschlagen.`);
    return r.slice(1, 1 + BLK);
  }
  async function writeBlock(addr, data264) {
    const d = Array.from(data264).slice(0, BLK); while (d.length < BLK) d.push(0x00);
    const r = await tx(frame([0x55, 0x72, 0x01, 0x0C, 0x00, 0x00, 0x82, 0x00, addr & 0xff, (addr >> 8) & 0xff, ...d]), wantAck);
    return r.length >= 1 && r[0] === 0x06;
  }

  // Maschinen-Config (8192 B) von der Karte lesen
  async function readConfig(onProgress) {
    const nblocks = Math.ceil(CFG_SIZE / BLK);           // 32
    const buf = new Uint8Array(nblocks * BLK);
    for (let i = 0; i < nblocks; i++) {
      const d = await readBlock(CFG_ADDR0 + i * 2);
      buf.set(d, i * BLK);
      if (onProgress) onProgress(i + 1, nblocks);
    }
    return buf.slice(0, CFG_SIZE);
  }
  // Maschinen-Config (8192 B) auf die Karte schreiben, je Block Rücklese-Verify
  async function writeConfig(data, onProgress) {
    if (data.length !== CFG_SIZE) throw new Error(`Config muss ${CFG_SIZE} Byte sein (ist ${data.length}).`);
    const nblocks = Math.ceil(CFG_SIZE / BLK);           // 32
    for (let i = 0; i < nblocks; i++) {
      const addr = CFG_ADDR0 + i * 2;
      const off = i * BLK;
      let block;
      if (off + BLK <= CFG_SIZE) {
        block = Array.from(data.slice(off, off + BLK));
      } else {
        // letzter Teil-Block: Config-Rest + vorhandene Kartenbytes erhalten (read-modify-write)
        const cur = await readBlock(addr);
        block = Array.from(cur);
        const rest = data.slice(off);                     // 8 Bytes
        for (let k = 0; k < rest.length; k++) block[k] = rest[k];
      }
      const ok = await writeBlock(addr, block);
      if (!ok) throw new Error(`Block @${addr} schreiben fehlgeschlagen.`);
      // Verify
      const back = await readBlock(addr);
      for (let k = 0; k < block.length; k++) {
        if (back[k] !== block[k]) throw new Error(`Verify-Fehler Block @${addr}, Byte ${k}: geschrieben ${block[k]}, gelesen ${back[k]}.`);
      }
      if (onProgress) onProgress(i + 1, nblocks);
    }
    return true;
  }

  async function disconnect() {
    try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (e) {}
    try { if (readLoopDone) await readLoopDone; } catch (e) {}
    try { if (writer) writer.releaseLock(); } catch (e) {}
    try { if (port) await port.close(); } catch (e) {}
    port = reader = writer = null; rx = [];
    emit('status', { connected: false });
  }
  return { supported, connect, disconnect, on, init, readBlock, writeBlock, readConfig, writeConfig, CFG_SIZE };
})();
if (typeof module !== 'undefined') module.exports = FlashCard;
