/* pn532.js — PN532 USB-C (Elechouse NFC-Modul, HSU/UART) über WebSerial, für ST SRI512 / SRIX (Typ B').
 *
 * Transport nach dem VERIFIZIERTEN Elechouse-Web-Serial-Tester aufgebaut:
 *   - Wakeup-Preambel + erstes Kommando in EINEM write() (übersteht puffernde USB-UART-Bridges)
 *   - erst ACK (00 00 FF 00 FF 00) abwarten, dann Datenframe mit LCS/DCS/Postamble-Prüfung
 *   - Antwort-Check: TFI 0xD5 + (CMD+1)
 *
 * Darüber unsere SRIX-Schicht: ST-SR-Luftbefehle über InCommunicateThru (0x42) + CRC-B.
 *   Initiate 06 00 · Select 0E <id> · Get-UID 0B · Read 08 <blk> · Write 09 <blk> <4B>
 * Der PN532 wird davor per WriteRegister auf ISO14443-B-Framing umgestellt (TxMode/RxMode).
 *
 * PN532-HSU-Frame:  00 00 FF LEN LCS TFI PD… DCS 00   (TFI=0xD4 host→PN532, Antwort 0xD5)
 */
const PN532 = (function () {
  const HOST = 0xD4, DEV = 0xD5;
  const ACK = [0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00];
  // Wakeup + erstes Kommando zusammen senden (Elechouse: "survives USB-UART bridges that buffer small writes")
  const WAKEUP = [0x55, 0x55, ...Array(12).fill(0x00)];
  const CMD = {
    GET_FIRMWARE: 0x02, SAM_CONFIG: 0x14, RF_CONFIG: 0x32,
    WRITE_REGISTER: 0x08, IN_COMMUNICATE_THRU: 0x42, IN_LIST_PASSIVE: 0x4A,
  };
  // CIU-Register-Sequenz für ISO14443-B'/ST-SR (aus libnfc NMT_ISO14443B2SR, Adressen verifiziert).
  // CRC schalten wir ab (0x03) und hängen CRC-B selbst an. Die 3 Analog-Register (TxAuto/CWGsP/ModGsP)
  // sind entscheidend — ohne sie treibt der PN532 das Feld für Type B nicht und die Karte bleibt stumm.
  const TYPEB_REGS = [
    0x63, 0x02, 0x03,  // CIU_TxMode  : ISO14443B-Framing, 106 kbps, CRC aus
    0x63, 0x03, 0x03,  // CIU_RxMode  : dito
    0x63, 0x05, 0x07,  // CIU_TxAuto  : Initial RF On + Tx1/Tx2 RF-AutoEn
    0x63, 0x18, 0x3f,  // CIU_CWGsP   : P-Treiber-Leitwert (Dauerträger)
    0x63, 0x19, 0x12,  // CIU_ModGsP  : P-Treiber-Leitwert bei Modulation
  ];

  let port = null, writer = null;
  let rx = [], waiters = [], reader = null, readLoopDone = null, closed = false, bytesSinceDrain = 0;
  const listeners = { log: [], status: [] };
  const supported = () => 'serial' in navigator;
  const emit = (ev, x) => listeners[ev] && listeners[ev].forEach(fn => { try { fn(x); } catch (e) {} });
  const on = (ev, fn) => { if (listeners[ev]) listeners[ev].push(fn); };
  const hex = arr => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(' ');

  /* ---------- Transport: Lese-Loop + Waiter (nach Elechouse-Tester) ---------- */
  function startReader() {
    closed = false; rx = []; waiters = []; bytesSinceDrain = 0;
    reader = port.readable.getReader();
    readLoopDone = (async () => {
      try {
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) { for (const b of value) rx.push(b); bytesSinceDrain += value.length; notify(); }
        }
      } catch (e) { if (!closed) emit('log', { dir: 'rx', hex: 'read-error: ' + e.message }); }
      finally { try { reader.releaseLock(); } catch (e) {} reader = null; }
    })();
  }
  const notify = () => { [...waiters].forEach(w => w.check()); };

  function waitFor(extractor, timeoutMs, label) {
    if (closed) return Promise.reject(new Error('Port geschlossen'));
    return new Promise((resolve, reject) => {
      const w = {
        check: () => {
          try { const r = extractor(rx); if (r === null) return; clearTimeout(t); drop(w); resolve(r); }
          catch (e) { clearTimeout(t); drop(w); reject(e); }
        }, reject,
      };
      const t = setTimeout(() => {
        drop(w);
        const d = bytesSinceDrain ? `; ${bytesSinceDrain} Byte empfangen, aber kein gültiger ${label || 'Frame'}` : '; keine Daten empfangen';
        reject(new Error(`${label || 'Lesen'}: Timeout nach ${timeoutMs} ms${d}`));
      }, timeoutMs);
      waiters.push(w); w.check();
    });
  }
  const drop = w => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); };
  const drain = () => { if (rx.length) emit('log', { dir: 'rx', hex: `(${rx.length} alte Byte verworfen)` }); rx.length = 0; bytesSinceDrain = 0; };

  function findSeq(buf, pat) {
    outer: for (let i = 0; i <= buf.length - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) if (buf[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }
  function extractAck(buf) {
    const i = findSeq(buf, ACK);
    if (i === -1) { if (buf.length > 64) buf.splice(0, buf.length - 8); return null; }
    buf.splice(0, i + ACK.length); return ACK;
  }
  function extractFrame(buf) {
    while (true) {
      const s = findSeq(buf, [0x00, 0x00, 0xFF]);
      if (s === -1) { if (buf.length > 64) buf.splice(0, buf.length - 2); return null; }
      if (s > 0) buf.splice(0, s);
      if (buf.length < 6) return null;
      const len = buf[3], lcs = buf[4];
      if (len === 0x00 && lcs === 0xFF) { buf.splice(0, ACK.length); continue; } // ACK dazwischen
      if (((len + lcs) & 0xff) !== 0) { buf.shift(); continue; }
      const total = len + 7;
      if (buf.length < total) return null;
      const pkt = buf.slice(0, total);
      const body = pkt.slice(5, 5 + len);
      const dcs = pkt[5 + len], post = pkt[6 + len];
      const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
      buf.splice(0, total);
      if (((sum + dcs) & 0xff) !== 0) throw new Error('DCS-Prüfsumme falsch: ' + hex(pkt));
      if (post !== 0x00) throw new Error('Postamble falsch: ' + hex(pkt));
      return body;
    }
  }

  async function write(bytes) {
    if (!writer) writer = port.writable.getWriter();
    emit('log', { dir: 'tx', hex: hex(bytes) });
    await writer.write(Uint8Array.from(bytes));
  }
  function buildFrame(cmd, params) {
    const body = [HOST, cmd, ...params];
    const len = body.length & 0xff;
    const lcs = (0x100 - len) & 0xff;
    let sum = 0; for (const b of body) sum = (sum + b) & 0xff;
    const dcs = (0x100 - sum) & 0xff;
    return [0x00, 0x00, 0xFF, len, lcs, ...body, dcs, 0x00];
  }

  // Ein Kommando: (optional Wakeup+)Frame in EINEM write, ACK abwarten, Datenframe prüfen -> Params nach (D5,CMD+1)
  async function command(cmd, params = [], { timeout = 1500, ackTimeout = 1500, wakeup = false } = {}) {
    const frame = buildFrame(cmd, params);
    const wire = wakeup ? [...WAKEUP, ...frame] : frame;
    drain();
    await write(wire);
    await waitFor(extractAck, ackTimeout, 'ACK');
    const body = await waitFor(extractFrame, timeout, 'PN532-Antwort');
    emit('log', { dir: 'rx', hex: hex(body) });
    if (body[0] !== DEV) throw new Error('Falsche Frame-Richtung: ' + hex(body));
    if (body[1] !== ((cmd + 1) & 0xff)) throw new Error('Falscher Antwort-Code: ' + hex(body));
    return body.slice(2);
  }

  /* ---------- PN532-Basis ---------- */
  // Init-Kommandos (Firmware, SAM) IMMER mit Wakeup-Preambel — der HSU-Chip döst zwischen Kommandos weg.
  async function getFirmwareVersion() {
    const d = await command(CMD.GET_FIRMWARE, [], { timeout: 2000, wakeup: true });
    if (d.length < 4) throw new Error('Kurze Firmware-Antwort: ' + hex(d));
    return { ic: d[0], version: d[1], revision: d[2], support: d[3], text: `${d[0] === 0x32 ? 'PN532' : '0x' + d[0].toString(16)} v${d[1]}.${d[2]}` };
  }
  async function samConfig() { return command(CMD.SAM_CONFIG, [0x01, 0x14, 0x01], { timeout: 2000, wakeup: true }); }
  async function rfFieldOn() { return command(CMD.RF_CONFIG, [0x01, 0x01]); }            // CfgItem 01: RF-Feld an
  async function writeRegister(pairs) { return command(CMD.WRITE_REGISTER, pairs); }     // [hi,lo,val, …]
  // PN532 für ISO14443-B'/ST-SR vorbereiten (Framing + Analog-Treiber), siehe TYPEB_REGS
  async function typeBInit() { return writeRegister(TYPEB_REGS); }
  // InListPassiveTarget: brTy 0x00=ISO14443A(106k), 0x03=ISO14443B(106k, braucht AFI). Rohdaten zurück.
  async function inListPassive(brTy, initData = [], timeout = 1200) {
    try {
      const d = await command(CMD.IN_LIST_PASSIVE, [0x01, brTy, ...initData], { timeout });
      return { nbTg: d[0] || 0, data: d };
    } catch (e) { return { nbTg: 0, data: null, error: e.message }; }
  }
  // Diagnose: welche Funktechnik beantwortet überhaupt etwas? (nur Logging)
  async function probeCardTypes() {
    const a = await inListPassive(0x00);                 // ISO14443A
    emit('log', { dir: 'rx', hex: `Probe Typ-A : ${a.data ? (a.nbTg ? hex(a.data) : 'keine Karte (NbTg=0)') : 'Fehler/Timeout ' + (a.error || '')}` });
    const b = await inListPassive(0x03, [0x00]);         // ISO14443B, AFI=0x00 (alle)
    emit('log', { dir: 'rx', hex: `Probe Typ-B : ${b.data ? (b.nbTg ? hex(b.data) : 'keine Karte (NbTg=0)') : 'Fehler/Timeout ' + (b.error || '')}` });
    return { typeA: a, typeB: b };
  }

  /* ---------- CRC-B (ISO/IEC 14443-B, X-25) ---------- */
  function crcB(bytes) {
    let crc = 0xFFFF;
    for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >> 1) ^ 0x8408 : crc >> 1; }
    crc = (~crc) & 0xFFFF;
    return [crc & 0xff, (crc >> 8) & 0xff];
  }
  // SRIX-Luftbefehl über InCommunicateThru (0x42): CRC-B anhängen, Antwort = [Status, Daten…(+CRC)]
  async function srix(cmdBytes, { timeout = 600 } = {}) {
    const withCrc = [...cmdBytes, ...crcB(cmdBytes)];
    const resp = await command(CMD.IN_COMMUNICATE_THRU, withCrc, { timeout });
    if (!resp || resp.length < 1) return null;
    const status = resp[0];
    if (status !== 0x00) return { status, data: [] };
    let data = resp.slice(1);
    if (data.length >= 2) data = data.slice(0, -2); // CRC-B abschneiden
    return { status: 0, data };
  }

  /* ---------- SRIX High-Level ---------- */
  async function select() {
    let chipId = null;
    for (let a = 0; a < 16 && chipId === null; a++) {
      try { const ini = await srix([0x06, 0x00]); if (ini && ini.status === 0 && ini.data.length >= 1) chipId = ini.data[0]; } catch (e) {}
      if (chipId === null) await new Promise(r => setTimeout(r, 40));
    }
    if (chipId === null) throw new Error('PN532: keine SRIX-Karte erkannt (Initiate). Karte auflegen & Feld prüfen.');
    await srix([0x0E, chipId]);               // Select(Chip-ID)
    const u = await srix([0x0B]);             // Get-UID (8 Byte)
    const uid = u && u.data.length >= 8 ? u.data.slice(0, 8) : [];
    return { chipId, uid, uidText: uidToText(uid) };
  }
  function uidToText(uid) {
    if (!uid || uid.length < 8) return '';
    const h = i => uid[i].toString(16).padStart(2, '0').toUpperCase();
    return `${h(1)}${h(0)}-${h(3)}${h(2)}-${h(5)}${h(4)}-${h(7)}${h(6)}`;
  }
  async function readBlock(blk) { const r = await srix([0x08, blk]); return r && r.data.length >= 4 ? r.data.slice(0, 4) : null; }
  // SRIX/ST25TB: Write_block (0x09) wird NICHT beantwortet (Chip schreibt still ~5 ms).
  // Also schreiben, Tw abwarten, zurücklesen und vergleichen — kein Status-Check.
  async function writeBlock(blk, data4) {
    try { await srix([0x09, blk, ...data4], { timeout: 150 }); } catch (e) {}  // Timeout ist hier normal
    await new Promise(r => setTimeout(r, 7));                                    // Tw: EEPROM-Schreibzeit
    const rb = await readBlock(blk);
    return !!rb && [0, 1, 2, 3].every(i => rb[i] === (data4[i] & 0xff));
  }

  // Standard-ISO14443-B-Antwort (ATQB) parsen:  NbTg, Tg, 0x50, PUPI(4), AppData(4), ProtocolInfo(3), …
  function parseTypeB(d) {
    const pupi = d.slice(3, 7), appData = d.slice(7, 11), proto = d.slice(11, 14);
    const uidText = pupi.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join('');
    const iso4 = (proto.length >= 2) && ((proto[1] & 0x01) !== 0);  // ProtocolInfo: ISO14443-4-konform?
    emit('log', { dir: 'rx', hex: `ISO14443-B erkannt — PUPI ${uidText} · AppData ${hex(appData)} · Proto ${hex(proto)} · ISO14443-4 ${iso4 ? 'ja' : 'nein'}` });
    return {
      typeB: true, iso144434: iso4,
      uid: Array.from(pupi), uidText, pupi: Array.from(pupi), appData: Array.from(appData), protocolInfo: Array.from(proto),
      atqb: d.slice(2), raw: Array.from(d),
      chipId: null, counter: null, credit: null, codeB: null,
      blocks: {}, blockHex: {},
    };
  }

  async function readCard() {
    await rfFieldOn();
    // Auto-Erkennung: Standard-ISO14443-B antwortet auf InListPassiveTarget, ST-SR/SRIX nicht.
    const b = await inListPassive(0x03, [0x00], 1500);   // Typ B, AFI 0x00
    if (b.data && b.nbTg > 0 && b.data.length >= 7) return parseTypeB(b.data);
    emit('log', { dir: 'rx', hex: 'kein Standard-Typ-B — versuche ST-SR/SRIX …' });
    // --- ST-SR/SRIX-Weg (servosecure SRI512) ---
    await typeBInit();
    const sel = await select();
    const blocks = {};
    for (let b2 = 0x00; b2 <= 0x0f; b2++) blocks[b2] = await readBlock(b2);
    const b05 = blocks[0x05], b08 = blocks[0x08], b0a = blocks[0x0a];
    return {
      uid: sel.uid, uidText: sel.uidText, chipId: sel.chipId,
      counter: b05 ? b05[0] : null,
      credit: b08 ? (b08[0] | (b08[1] << 8)) : null,
      codeB: b0a ? ((b0a[2] | (b0a[3] << 8)) || (b0a[0] | (b0a[1] << 8))) : null,
      blocks,
      blockHex: Object.fromEntries(Object.entries(blocks).map(([k, v]) =>
        [k, v ? v.map(x => x.toString(16).padStart(2, '0')).join('') : null])),
    };
  }

  /* ---------- Verbindung ---------- */
  async function connect({ filtered = false, reuse = true } = {}) {
    if (!supported()) throw new Error('Web Serial nicht verfügbar — Chrome/Edge am Desktop nötig.');
    port = null;
    if (reuse) { try { const ps = await navigator.serial.getPorts(); port = ps[0] || null; } catch (e) {} }
    if (!port) port = await navigator.serial.requestPort(filtered ? { filters: [{ usbVendorId: 0x0403 }] } : {});
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    startReader();
    const fw = await getFirmwareVersion();   // Link sofort verifizieren
    emit('log', { dir: 'rx', hex: `Firmware: ${fw.text} (Support 0x${fw.support.toString(16)})` });
    await samConfig();
    emit('status', { connected: true, firmware: fw.text });
    return { connected: true, firmware: fw };
  }

  async function disconnect() {
    closed = true;
    waiters.splice(0).forEach(w => w.reject(new Error('Port geschlossen')));
    try { if (reader) await reader.cancel(); } catch (e) {}
    try { if (readLoopDone) await readLoopDone; } catch (e) {}
    try { if (writer) { writer.releaseLock(); } } catch (e) {}
    try { if (port) await port.close(); } catch (e) {}
    port = writer = null; rx = [];
    emit('status', { connected: false });
  }

  return { supported, connect, disconnect, on, readCard, readBlock, writeBlock, select, getFirmwareVersion, uidToText };
})();
if (typeof module !== 'undefined') module.exports = PN532;
