/* binformat.js — Erkennung + Read-only-Inspektion der Binär-Konfigs (.dat/.da3) und Firmware.
 * Vollständiges Editieren der Binärformate folgt, wenn die Feld-Offsets per Ein-Wert-Diffs
 * dekodiert sind (siehe docs/06). Vorläufig: Format erkennen, Klartext-Strings + Hex anzeigen.
 */
const BinFormat = (function () {
  const dec = bytes => new TextDecoder('latin1').decode(bytes);

  function detect(bytes) {
    const n = bytes.length;
    const head = dec(bytes.slice(0, 64)).replace(/^\s+/, '');
    if (head.startsWith('<?xml')) return { format: 'da2', label: 'da2 (XML, editierbar)', size: n };
    if (head.startsWith('S0') || /^S[1-3]\d/.test(head)) return { format: 'srec', label: 'Firmware (Motorola S-Record)', size: n };
    if (head.startsWith(':') && /^:[0-9A-Fa-f]{8}/.test(head)) return { format: 'ihex', label: 'Firmware/Image (Intel-HEX)', size: n };
    if (n === 3500) return { format: 'dat', label: '.dat Classic (3500 B, ältere Maschinen)', size: n, stride: null };
    if (n === 8192) return { format: 'dat', label: '.dat Classic (8192 B)', size: n, stride: 0x48 };
    if (n === 8640) return { format: 'da3', label: '.da3 (8640 B, rhea LaRhea/IC V14)', size: n, stride: 0x64 };
    return { format: 'unknown', label: 'Unbekanntes Format', size: n };
  }

  function strings(bytes, min = 3) {
    const out = []; let cur = '', start = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b < 127) { if (!cur) start = i; cur += String.fromCharCode(b); }
      else { if (cur.length >= min) out.push({ off: start, text: cur }); cur = ''; }
    }
    if (cur.length >= min) out.push({ off: start, text: cur });
    return out;
  }

  function hex(bytes, limit) {
    const end = limit ? Math.min(limit, bytes.length) : bytes.length;
    const lines = [];
    for (let i = 0; i < end; i += 16) {
      let h = '', a = '';
      for (let j = 0; j < 16; j++) {
        if (i + j < end) { const v = bytes[i + j]; h += v.toString(16).padStart(2, '0') + ' '; a += (v >= 32 && v < 127) ? String.fromCharCode(v) : '.'; }
        else h += '   ';
      }
      lines.push(i.toString(16).padStart(4, '0') + '  ' + h + ' ' + a);
    }
    return lines.join('\n');
  }

  // Bekannte Tabellen-Layouts (aus Diff/Inspektion abgeleitet; siehe docs/06).
  // Namenstabellen: feste NUL-gepaddete Slots. Startoffset wird dynamisch gesucht
  // (die Tabelle ist nicht fix ausgerichtet), Suchfenster + Slotbreite sind bekannt.
  const LAYOUTS = {
    'dat|8192': [
      { name: 'Produktkanäle', from: 0x820, to: 0x900, stride: 0x1e, max: 8 },
      { name: 'Auswahl-Namen', from: 0x9f0, to: 0x9fc, stride: 0x14, max: 26 },
    ],
    'da3|8640': [
      { name: 'Produktkanäle', from: 0x1f80, to: 0x2010, stride: 0x10, max: 12 },
    ],
  };
  const isAlpha = v => (v >= 65 && v <= 90) || (v >= 97 && v <= 122);

  // Bestes Alignment: Slot startet mit Buchstabe, enthält NUL, letztes Byte ist Padding (0).
  function findTable(bytes, from, to, stride) {
    let best = { off: from, score: -1 };
    for (let o = from; o <= to; o++) {
      let score = 0;
      for (let i = 0; i < 10; i++) {
        const s = o + i * stride, e = s + stride; if (e > bytes.length) break;
        if (!isAlpha(bytes[s])) continue;
        let nul = -1; for (let j = 0; j < stride; j++) { if (bytes[s + j] === 0) { nul = j; break; } }
        if (nul >= 2 && bytes[e - 1] === 0) {
          let ok = true; for (let j = 0; j < nul; j++) { const v = bytes[s + j]; if (!(v >= 32 && v < 127)) { ok = false; break; } }
          if (ok) score++;
        }
      }
      if (score > best.score) best = { off: o, score };
    }
    return best.off;
  }

  function parseTable(bytes, off, stride, max) {
    const rows = [];
    for (let i = 0; i < max; i++) {
      const s = off + i * stride; if (s + stride > bytes.length) break;
      if (!isAlpha(bytes[s]) && bytes[s] !== 0) break; // Tabellenende (z. B. Flag-Block)
      let t = '';
      for (let j = 0; j < stride; j++) { const v = bytes[s + j]; if (v === 0) break; if (v >= 32 && v < 127) t += String.fromCharCode(v); }
      rows.push({ off: s, text: t.trim() });
    }
    while (rows.length && !rows[rows.length - 1].text) rows.pop();
    return rows;
  }

  function tables(bytes, det) {
    const defs = LAYOUTS[det.format + '|' + det.size]; if (!defs) return [];
    return defs.map(d => { const off = findTable(bytes, d.from, d.to, d.stride); return { name: d.name, off, rows: parseTable(bytes, off, d.stride, d.max) }; });
  }

  return { detect, strings, hex, tables };
})();
