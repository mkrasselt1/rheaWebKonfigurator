/* da2.js — Parser/Serializer für rheavendors .da2 (Klartext-XML)
 * Format: <rheavendorsVMCSettings> mit Sektionen (VMCGen, VMCAdv, VMCPay, VMCPwr, VMCx)
 * und je Auswahl <VMCSel S="n">. Elementtext ist "KEY=VALUE;KEY=VALUE;".
 * Strings in "...", sonst Zahlen. <VMCSel> enthält zusätzlich <I>-Zünd-Schritte.
 * Verlustarm: Reihenfolge, Quoting und Attribute bleiben erhalten (semantischer Round-Trip).
 */
const DA2 = (function () {
  function parseKV(text) {
    const pairs = [];
    const re = /([A-Za-z0-9_]+)=("[^"]*"|[^;]*);?/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      const raw = m[2];
      const quoted = raw.startsWith('"');
      const value = quoted ? raw.slice(1, -1) : raw;
      pairs.push({ key: m[1], value, quoted });
    }
    return pairs;
  }

  function kvToString(pairs) {
    return pairs.map(p => p.key + '=' + (p.quoted ? ('"' + p.value + '"') : p.value) + ';').join('');
  }

  function directText(el) {
    let s = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) s += n.nodeValue; });
    return s;
  }

  function parse(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const perr = doc.querySelector('parsererror');
    if (perr) throw new Error('XML-Parsefehler: ' + perr.textContent.trim());
    const root = doc.documentElement;
    const sections = [];
    Array.from(root.children).forEach(el => {
      const sec = { tag: el.tagName, attrs: {}, pairs: parseKV(directText(el)), items: [] };
      Array.from(el.attributes).forEach(a => (sec.attrs[a.name] = a.value));
      Array.from(el.children).forEach(ch => {
        sec.items.push({ tag: ch.tagName, pairs: parseKV(directText(ch)) });
      });
      sections.push(sec);
    });
    return { root: root.tagName, sections };
  }

  function serialize(model) {
    const NL = '\r\n';
    let out = '<?xml version="1.0"?>' + NL + '<' + model.root + '>' + NL;
    model.sections.forEach(sec => {
      let attr = '';
      for (const k in sec.attrs) attr += ' ' + k + '="' + sec.attrs[k] + '"';
      out += '<' + sec.tag + attr + '>' + kvToString(sec.pairs);
      sec.items.forEach(it => (out += '<' + it.tag + '>' + kvToString(it.pairs) + '</' + it.tag + '>'));
      out += '</' + sec.tag + '>' + NL;
    });
    out += '</' + model.root + '>' + NL;
    return out;
  }

  const findSection = (model, tag, S) =>
    model.sections.find(s => s.tag === tag && (S === undefined || s.attrs.S === String(S)));
  const getVal = (sec, key) => { const p = sec.pairs.find(x => x.key === key); return p ? p.value : undefined; };
  const setVal = (sec, key, val) => { const p = sec.pairs.find(x => x.key === key); if (p) p.value = String(val); return !!p; };

  return { parse, serialize, parseKV, kvToString, findSection, getVal, setVal };
})();

if (typeof module !== 'undefined') module.exports = DA2;
