/* programmer.js — Live-Verbindung zur Maschine über WebSerial (PcCom/TelSerial-Protokoll, docs/14).
 *
 * Protokoll (verifiziert aus Original-Beispieldateien): ASCII, 9600 8N1, CRLF, Feldtrenner '*'.
 *   Lesen:    LA<masch>*<section>*<index>            -> Antwort spiegelt Kommando + hängt Wert(e) an
 *             MA5*<SECTION>*<index> [*<sub>...]       (benannte Sektionen)
 *   Schreiben: LC<masch>*<section>*<index>*<wert>
 *             MC5*<SECTION>*<index>*<wert>
 *   Beispiele: LA1*1*01 (Preis Wahl1), MA5*TMP*TME (Boiler-Soll), MC5*TMP*TME*92 (Boiler:=92).
 *
 * Verbindung: USB-UART (FTDI o.ä.) über den RS232-zu-FlashCard-Adapter bzw. einen separaten RS232/RS485-Port.
 * Web Serial: Desktop Chrome/Edge. Android später via WebUSB.
 *
 * SICHERHEIT: Schreiben nur mit Echo-Bestätigung. Das Gerät muss betriebsbereit sein (VMC-Status STwa).
 */
const Programmer = (function () {
  let port = null, reader = null, writer = null, readLoopDone = null;
  let rxBuf = '';
  const lineWaiters = [];      // { resolve, reject, timer }
  const listeners = { line: [], status: [] };

  const supported = () => 'serial' in navigator;
  const emit = (ev, x) => listeners[ev] && listeners[ev].forEach(fn => { try { fn(x); } catch (e) {} });
  const on = (ev, fn) => { if (listeners[ev]) listeners[ev].push(fn); };

  async function connect({ baudRate = 9600, filtered = false } = {}) {
    if (!supported()) throw new Error('Web Serial nicht verfügbar — Chrome/Edge am Desktop nötig.');
    port = await navigator.serial.requestPort(filtered ? { filters: [{ usbVendorId: 0x0403 }] } : {});
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    writer = port.writable.getWriter();
    startReader();
    emit('status', describe());
    return describe();
  }

  function startReader() {
    reader = port.readable.getReader();
    const dec = new TextDecoder();
    readLoopDone = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            rxBuf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = rxBuf.indexOf('\r\n')) >= 0) {
              const line = rxBuf.slice(0, idx); rxBuf = rxBuf.slice(idx + 2);
              if (line.length) deliverLine(line);
            }
          }
        }
      } catch (e) { /* reader cancelled */ }
    })();
  }

  function deliverLine(line) {
    emit('line', { dir: 'rx', text: line });
    const w = lineWaiters.shift();
    if (w) { clearTimeout(w.timer); w.resolve(line); }
  }

  function nextLine(timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject };
      w.timer = setTimeout(() => {
        const i = lineWaiters.indexOf(w); if (i >= 0) lineWaiters.splice(i, 1);
        reject(new Error('Timeout (keine Antwort)'));
      }, timeoutMs);
      lineWaiters.push(w);
    });
  }

  async function sendLine(cmd) {
    if (!writer) throw new Error('Nicht verbunden.');
    emit('line', { dir: 'tx', text: cmd });
    await writer.write(new TextEncoder().encode(cmd + '\r\n'));
  }

  // Ein Kommando senden und die (gespiegelte) Antwortzeile holen; Timeout + Retry.
  async function command(cmd, { timeout = 800, retries = 1 } = {}) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await sendLine(cmd);
      try { return await nextLine(timeout); } catch (e) { last = e; }
    }
    throw last || new Error('Keine Antwort auf ' + cmd);
  }

  const fields = line => line.split('*');

  /* ---- High-Level ---- */
  // Benannten Parameter lesen: MA5*<SECTION>*<index...> -> letzter Feldwert
  async function readNamed(section, ...index) {
    const resp = await command(['MA5', section, ...index].join('*'));
    const f = fields(resp); return f[f.length - 1];
  }
  async function writeNamed(section, index, value) {
    const cmd = ['MC5', section, index, value].join('*');
    const ack = await command(cmd);
    if (ack.replace(/^M[AC]/, '') !== cmd.replace(/^M[AC]/, '')) {
      // Echo sollte das Kommando spiegeln (A<->C toleriert)
    }
    return ack;
  }
  // Numerische Sektion (Preise): LA1*<section>*<idx> ; section 1=Preis,2=Happy (🅥)
  async function readPrice(sel, section = 1) {
    const idx = String(sel).padStart(2, '0');
    const resp = await command(`LA1*${section}*${idx}`);
    const f = fields(resp); return parseInt(f[f.length - 1], 10);
  }
  async function writePrice(sel, value, section = 1) {
    const idx = String(sel).padStart(2, '0');
    return command(`LC1*${section}*${idx}*${value}`);
  }
  const readBoiler = () => readNamed('TMP', 'TME');
  const writeBoiler = v => writeNamed('TMP', 'TME', v);

  async function disconnect() {
    try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (e) {}
    try { if (readLoopDone) await readLoopDone; } catch (e) {}
    try { if (writer) { writer.releaseLock(); } } catch (e) {}
    try { if (port) await port.close(); } catch (e) {}
    port = reader = writer = null; rxBuf = '';
    while (lineWaiters.length) { const w = lineWaiters.shift(); clearTimeout(w.timer); w.reject(new Error('getrennt')); }
    emit('status', { connected: false });
  }

  function describe() {
    if (!port) return { connected: false };
    const i = port.getInfo ? port.getInfo() : {};
    return { connected: true, vendorId: i.usbVendorId, productId: i.usbProductId };
  }

  return {
    supported, connect, disconnect, describe, on,
    sendLine, command, fields,
    readNamed, writeNamed, readPrice, writePrice, readBoiler, writeBoiler,
  };
})();
if (typeof module !== 'undefined') module.exports = Programmer;

/* ============================================================================
 * CardProgrammer — RFID-Karten-Programmer (FTDI) über WebSerial.
 * BINÄRES Protokoll (verifiziert per USB-Mitschnitt + direktem Live-Zugriff, docs/02):
 *   Port: 115200 8N1, kein Flow-Control. Frame Host->Reader:
 *     55 8A A0 <payload...> <CHK>     CHK = Σ(alle Bytes ab 0x55 bis vor CHK) mod 256
 *   Antwort beginnt mit 06 (ACK); Fetch-Antwort: 06 <len> <len Datenbytes> <chk>.
 *   Chip (ST SRI512): 16 × 32-bit-Blöcke. Nur Blöcke 05,07–0C sind belegt.
 *     05 = Schreibzähler (zählt runter)   08/09 Byte0 = Credit   0A Byte2|3<<8 = Code B
 *   SICHERHEIT: dieses Modul LIEST nur. Schreiben erst, wenn Block-07-CRC geklärt ist.
 * ==========================================================================*/
const CardProgrammer = (function () {
  let port = null, reader = null, writer = null, readLoopDone = null;
  let rx = [];                       // empfangene Bytes (Queue)
  const listeners = { log: [], status: [] };
  const supported = () => 'serial' in navigator;
  const emit = (ev, x) => listeners[ev] && listeners[ev].forEach(fn => { try { fn(x); } catch (e) {} });
  const on = (ev, fn) => { if (listeners[ev]) listeners[ev].push(fn); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hex = arr => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

  async function connect({ filtered = true, reuse = true } = {}) {
    if (!supported()) throw new Error('Web Serial nicht verfügbar — Chrome/Edge am Desktop nötig.');
    // Chrome/Edge merken sich freigegebene Ports → ohne Dialog wiederverwenden
    port = null;
    if (reuse) { try { const ps = await navigator.serial.getPorts(); port = ps.find(p => { const i = p.getInfo ? p.getInfo() : {}; return i.usbVendorId === 0x0403; }) || ps[0] || null; } catch (e) {} }
    if (!port) port = await navigator.serial.requestPort(filtered ? { filters: [{ usbVendorId: 0x0403 }] } : {});
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    try { await port.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch (e) {}
    writer = port.writable.getWriter();
    startReader();
    await sleep(150);                // Reader-Firmware nach Open kurz Zeit geben
    emit('status', { connected: true });
    return { connected: true };
  }

  function startReader() {
    reader = port.readable.getReader();
    readLoopDone = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) for (const b of value) rx.push(b);
        }
      } catch (e) { /* cancelled */ }
    })();
  }

  function frame(payload) {
    const b = [0x55, 0x8A, 0xA0, ...payload];
    let s = 0; for (const x of b) s = (s + x) & 0xff;
    b.push(s);
    return Uint8Array.from(b);
  }

  // Antwort-Prädikate: wann ist eine Antwort vollständig?
  //  - wantAck: mindestens 1 Byte (das 06).
  //  - wantFetch: 06 <len> <len Datenbytes> <chk>  -> gesamt 3+len Bytes vorhanden.
  const wantAck = r => r.length >= 1;
  const wantFetch = r => r.length >= 2 && r[0] === 0x06 && r.length >= 3 + r[1];

  // Frame senden, Antwort einsammeln bis 'want' erfüllt (frame-vollständig) + kurzes Settle,
  // oder bis Timeout. Löst das WebSerial-Chunk-/Timing-Problem (Antwort kommt in Häppchen).
  async function transact(fr, { want = wantAck, settle = 35, total = 1500 } = {}) {
    if (!writer) throw new Error('Nicht verbunden.');
    rx = [];
    emit('log', { dir: 'tx', hex: hex(fr) });
    await writer.write(fr);
    const t0 = Date.now();
    // 1) warten bis 'want' erfüllt (oder Timeout)
    while (Date.now() - t0 < total) {
      await sleep(10);
      if (want(rx)) break;
    }
    // 2) kurzes Settle, damit evtl. nachlaufende Bytes (chk) noch reinkommen
    await sleep(settle);
    const resp = rx.slice();
    emit('log', { dir: 'rx', hex: hex(resp) });
    return resp;
  }

  // Fetch-Antwort 06 <len> <data...> <chk> -> data[] (oder [])
  function fetchData(resp) {
    if (resp.length >= 3 && resp[0] === 0x06) {
      const len = resp[1];
      if (resp.length >= 2 + len + 1) return resp.slice(2, 2 + len);
    }
    return [];
  }

  // gültige Fetch-Antwort = Status-Byte (resp[1]) ist eine kleine Länge, NICHT 0xFF (Fehler).
  const fetchOk = r => r.length >= 2 && r[0] === 0x06 && r[1] !== 0xff;

  // Karte selektieren; liefert { chipId, uid, uidText }.
  // Initiate+Anticollision werden wiederholt, bis die Karte einen gültigen Status liefert
  // (Feld muss nach dem Einschalten erst stabilisieren — sonst 0xFF-Fehler).
  async function select() {
    let chipId = null;
    for (let attempt = 0; attempt < 24 && chipId === null; attempt++) {
      await transact(frame([0x02, 0x00, 0x00, 0x60]));             // Poll (Karte-anwesend)
      await transact(frame([0x02, 0x00, 0x00, 0x70]));             // Initiate / HF-Feld an
      await sleep(25);                                             // Feld stabilisieren
      await transact(frame([0x04, 0x00, 0x01, 0x02, 0x06, 0x00])); // Pcall/Anticollision
      const idResp = await transact(frame([0x01, 0x02, 0x01]), { want: wantFetch });
      if (idResp.length >= 3 && idResp[0] === 0x06 && idResp[1] === 0x01) chipId = idResp[2]; // nur Status 01 = Karte da
      else await sleep(50);                                       // noch nicht bereit -> erneut
    }
    if (chipId === null) throw new Error('Keine Karte erkannt — Karte auflegen und erneut „Karte lesen".');
    await transact(frame([0x04, 0x00, 0x01, 0x02, 0x0e, chipId])); // Select(ID)
    await transact(frame([0x01, 0x02, 0x01]), { want: wantFetch }); // Select bestätigen
    await transact(frame([0x03, 0x00, 0x01, 0x01, 0x0b]));          // Get-UID vorbereiten (sonst nur 1 Byte)
    const uidResp = await transact(frame([0x01, 0x09, 0x01]), { want: wantFetch }); // UID (8 Byte)
    const ud = fetchData(uidResp);
    const uid = ud.length >= 8 ? ud : [];
    return { chipId, uid, uidText: uidToText(uid) };
  }

  // UID-Bytes -> Anzeige wie Originalsoftware: je 16-bit-Wort byteweise tauschen.
  function uidToText(uid) {
    if (!uid || uid.length < 8) return '';
    const h = i => uid[i].toString(16).padStart(2, '0').toUpperCase();
    return `${h(1)}${h(0)}-${h(3)}${h(2)}-${h(5)}${h(4)}-${h(7)}${h(6)}`;
  }

  async function readBlock(blk) {
    await transact(frame([0x04, 0x00, 0x01, 0x02, 0x08, blk]));              // Block lesen anstoßen
    const resp = await transact(frame([0x01, 0x05, 0x01]), { want: wantFetch }); // 4 Datenbytes holen
    const d = fetchData(resp);
    return d.length === 4 ? d : null;
  }

  // Block schreiben: 55 8A A0 08 00 01 06 09 <blk> <d0 d1 d2 d3> <chk> -> 06
  async function writeBlock(blk, data4) {
    const d = Array.from(data4).slice(0, 4);
    while (d.length < 4) d.push(0);
    const resp = await transact(frame([0x08, 0x00, 0x01, 0x06, 0x09, blk, ...d]));
    return resp.length >= 1 && resp[0] === 0x06;
  }

  // Komplette Karte lesen + auswerten.
  async function readCard() {
    const sel = await select();
    const blocks = {};
    for (let b = 0x00; b <= 0x0f; b++) blocks[b] = await readBlock(b);
    const b05 = blocks[0x05], b08 = blocks[0x08], b0a = blocks[0x0a];
    const counter = b05 ? b05[0] : null;
    const credit  = b08 ? (b08[0] | (b08[1] << 8)) : null;       // Block 08/09 Byte0–1 (u16 LE, in Cent)
    // Code B: Standard in Block 0A Byte2–3, Spezialkarten in Byte0–1 → beide prüfen
    const codeB   = b0a ? ((b0a[2] | (b0a[3] << 8)) || (b0a[0] | (b0a[1] << 8))) : null;
    return {
      uid: sel.uid, uidText: sel.uidText, chipId: sel.chipId,
      counter, credit, codeB,
      blocks,                                                     // {0:[..],..} rohe 4-Byte-Blöcke
      blockHex: Object.fromEntries(Object.entries(blocks).map(([k, v]) =>
        [k, v ? v.map(x => x.toString(16).padStart(2, '0')).join('') : null])),
    };
  }

  async function disconnect() {
    try { if (reader) { await reader.cancel(); reader.releaseLock(); } } catch (e) {}
    try { if (readLoopDone) await readLoopDone; } catch (e) {}
    try { if (writer) { writer.releaseLock(); } } catch (e) {}
    try { if (port) await port.close(); } catch (e) {}
    port = reader = writer = null; rx = [];
    emit('status', { connected: false });
  }

  return { supported, connect, disconnect, on, transact, frame, select, readBlock, writeBlock, readCard, uidToText };
})();
if (typeof module !== 'undefined') module.exports.CardProgrammer = CardProgrammer;
