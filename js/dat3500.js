/* dat3500.js — Format-Deskriptor + Low-Level für Classic „.dat".
 * Checksumme @0x0780 = Σ(0x0000..0x077B) mod 256 (an 8+ Dateien verifiziert) — auch von DAT8192 genutzt.
 * Deskriptor-Felder: priceTables (16-bit BE, Stride 2 je Auswahl), nameTable (Stride 0x14), globals,
 * optional recipe (Record-relative Offsets). Offsets aus docs/11.
 */
const DAT3500 = (function () {
  const CK = 0x0780, SUM_END = 0x077C;

  function get(buf, f) {
    if (f.type === 'u8') return buf[f.off];
    if (f.type === 'u16be') return (buf[f.off] << 8) | buf[f.off + 1];
    if (f.type === 'str') { let s = ''; for (let i = 0; i < f.len; i++) { const v = buf[f.off + i]; if (v === 0) break; if (v >= 32 && v < 127) s += String.fromCharCode(v); } return s; }
  }
  function set(buf, f, val) {
    if (f.type === 'u8') { let n = parseInt(val, 10); if (!isFinite(n)) n = 0; buf[f.off] = n & 0xFF; }
    else if (f.type === 'u16be') { let n = parseInt(val, 10); if (!isFinite(n)) n = 0; n &= 0xFFFF; buf[f.off] = (n >> 8) & 0xFF; buf[f.off + 1] = n & 0xFF; }
    else if (f.type === 'str') { const s = String(val); for (let i = 0; i < f.len; i++) buf[f.off + i] = i < s.length ? (s.charCodeAt(i) & 0x7F) : 0; }
  }
  function checksum(buf) { let c = 0; for (let i = 0; i < SUM_END; i++) c = (c + buf[i]) & 0xFF; return c; }
  function finalize(buf) { buf[CK] = checksum(buf); return buf; }
  function verify(buf) { return buf[CK] === checksum(buf); }

  return {
    SIZE: 3500, CK, SUM_END,
    // Per-Auswahl-Strukturen
    recordStart: 0x0002, recordStride: 0x48,     // Record-Layout im 3500 noch unbestätigt → recipe:null
    priceTables: [0x0708, 0x0C90],               // Preis 1, Preis 2 (16-bit BE, Stride 2)
    priceLabels: ['Standard (Bar)', 'bargeldlos / Rabatt'],
    nameTable: 0x09F4, nameStride: 0x14, nameLen: 20,
    productTable: 0x0860, productStride: 0x1e, productLen: 30,  // Zutaten-/Behälternamen
    globals: [
      { key: 'boiler', off: 0x0759, type: 'u8', label: 'Boiler-Temperatur (°C)', min: 0, max: 120 },
      { key: 'ndec', off: 0x077B, type: 'u8', label: 'Nachkommastellen', min: 0, max: 3 },
    ],
    recipe: null,
    get, set, checksum, finalize, verify,
  };
})();
if (typeof module !== 'undefined') module.exports = DAT3500;
