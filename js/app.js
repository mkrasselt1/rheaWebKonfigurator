/* app.js — UI. da2 editieren (Filter, Validierung); .dat/.da3 read-only inspizieren. */
(function () {
  let model = null, fileName = 'config.da2', ndec = 2, SCH = null, binBuf = null, binMod = null, expert = false;

  const $ = s => document.querySelector(s);
  const status = m => { $('#status').textContent = m; };
  const applyMode = () => { const s = $('#sections'); if (s) s.classList.toggle('mode-expert', expert); const b = $('#mode'); if (b) b.checked = expert; };

  const LABELS = {
    Ver: 'rheAction-Version', GramsMode: 'Gramm-Dosierung (0/1)',
    MN: 'Maschinenname', MC: 'Machine Code', TY: 'Typ', FV: 'Format-Version',
    NP: 'Zutaten-Kanäle', NS: 'Anzahl Auswahlen',
    TE: 'Boiler-/Kaffeetemp (°C)', TS: 'Dampftemp (°C)', TC: 'Kalt/Choco-Temp (°C)',
    TR: 'Temp-Hysterese', CTh: 'Choco-Schwelle (°C)', PTh: 'Pumpen-Schwelle',
    BT: 'Beep-Zeit', FT: 'Lüfter-Laufzeit', SD: 'Std-Zucker-Stufe',
    PayType: 'Zahlsystem', NDec: 'Nachkommastellen', BA: 'Basis-Option',
    DN: 'Anzeigename (an Maschine)', FN: 'Beschreibung (intern)', NI: 'Anzahl Schritte',
    X: 'Gerät/Produktbehälter', D: 'Verzögerung', T: 'Dauer [dsec]', V: 'Geschw. 6/8/15 / Mahlzeit',
    Y: 'Produktvariation (%)', Z: 'Brüherdruck (0–10 mm)', SD: 'Zucker-Standard (0–6)', FK: 'Freevend-Key HW', BA: 'Banknoten-Annahme',
  };
  const PAYTYPE = { 0: '0 = Parallel einzeln', 1: '1 = Parallel mehrfach', 2: '2 = Executive', 3: '3 = Executive PriceHolding', 4: '4 = MDB', 5: '5 = Rhea parallel einzeln', 6: '6 = Rhea parallel mehrfach', 7: '7 = Rhea card + parallel', 8: '8 = Rhea card + Rhea parallel' };
  const labelFor = k => (SCH && SCH.fields[k] && SCH.fields[k].label) || LABELS[k] || (/^PN\d+$/.test(k) ? 'Zutat ' + k.slice(2) + ' Name' : (/^P[1-6]$/.test(k) ? 'Preis ' + k.slice(1) : k));

  const euro = v => { const n = Number(v); return isFinite(n) ? (n / Math.pow(10, ndec)).toLocaleString('de-DE', { minimumFractionDigits: ndec, maximumFractionDigits: ndec }) + ' €' : ''; };

  // --- Validierung (nicht blockierend, nur Warnung) ---
  function validate(sectionTag, key, value) {
    const v = String(value).trim(); const num = Number(v); const isInt = /^-?\d+$/.test(v);
    if (/^P[1-6]$/.test(key) && sectionTag === 'VMCSel') { if (!isInt || num < 0) return 'Preis: ganze Zahl ≥ 0'; if (num > 100000) return 'Preis unplausibel hoch'; }
    if (key === 'PayType') { const al = SCH ? Object.keys(SCH.payType).map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8]; return al.includes(num) ? null : ('Zahlsystem ' + al[0] + '–' + al[al.length - 1]); }
    if (key === 'NDec') return [0, 1, 2, 3].includes(num) ? null : 'Nachkommastellen 0–3';
    if (['TE', 'TS', 'TC', 'CTh', 'TR'].includes(key) && isInt && (num < 0 || num > 120)) return 'Temperatur 0–120 °C?';
    if (/^(MI|VH|VC|DD|SL)\d+$/.test(key) && !['0', '1'].includes(v)) return 'erwartet 0 oder 1';
    return null;
  }

  function input(pair, opts = {}) {
    const wrap = document.createElement('label'); wrap.className = 'kv';
    wrap.dataset.key = (pair.key + ' ' + (opts.label || labelFor(pair.key))).toLowerCase();
    const span = document.createElement('span'); span.textContent = opts.label || labelFor(pair.key);
    if (opts.enum) {
      const sel = document.createElement('select'); sel.className = 'enumsel';
      const cur = String(pair.value); let has = false;
      for (const k in opts.enum) { const o = document.createElement('option'); o.value = k; o.textContent = k + ' · ' + opts.enum[k]; if (k === cur) { o.selected = true; has = true; } sel.append(o); }
      if (!has) { const o = document.createElement('option'); o.value = cur; o.textContent = cur + ' · (?)'; o.selected = true; sel.append(o); }
      sel.addEventListener('change', () => { pair.value = sel.value; });
      wrap.append(span, sel); if (opts.wide) wrap.classList.add('wide'); return wrap;
    }
    if (opts.slider) {
      const r = document.createElement('input'); r.type = 'range'; r.min = opts.min != null ? opts.min : 0; r.max = opts.max != null ? opts.max : 120; r.value = pair.value;
      const out = document.createElement('output'); out.className = 'sliderval'; out.textContent = pair.value + (opts.unit || '');
      r.addEventListener('input', () => { pair.value = r.value; out.textContent = r.value + (opts.unit || ''); });
      const fld = document.createElement('div'); fld.className = 'sliderfield'; fld.append(r, out);
      wrap.append(span, fld); if (opts.wide) wrap.classList.add('wide'); return wrap;
    }
    const inp = document.createElement('input'); inp.value = pair.value;
    const hint = document.createElement('small'); hint.className = 'hint';
    const check = () => {
      const msg = validate(opts.section, pair.key, inp.value);
      inp.classList.toggle('invalid', !!msg);
      inp.title = msg || '';
      if (opts.euro) hint.textContent = euro(inp.value);
      else if (msg) hint.textContent = '⚠ ' + msg; else hint.textContent = '';
    };
    inp.addEventListener('input', () => { pair.value = inp.value; check(); });
    wrap.append(span, inp, hint); check();
    if (opts.wide) wrap.classList.add('wide');
    return wrap;
  }

  function overview() {
    const g = DA2.findSection(model, 'VMCGen'), pay = DA2.findSection(model, 'VMCPay'), ver = DA2.findSection(model, 'rheActionVer');
    const sels = model.sections.filter(s => s.tag === 'VMCSel');
    const pt = pay && DA2.getVal(pay, 'PayType');
    const box = document.createElement('div'); box.className = 'overview';
    const cell = (l, v) => `<div><span>${l}</span><strong>${v ?? '?'}</strong></div>`;
    const ptLabel = (SCH && SCH.payType[pt]) || PAYTYPE[pt] || pt;
    const plat = SCH ? ((SCH.modelKey ? SCH.modelKey + ' · ' : '') + SCH.platform.label) : '';
    box.innerHTML = cell('Maschine', g && DA2.getVal(g, 'MN')) + cell('Machine Code', g && DA2.getVal(g, 'MC')) +
      cell('Auswahlen', sels.length) + cell('Zahlsystem', ptLabel) + cell('Nachkommastellen', ndec) +
      cell('Schema', plat || (ver && DA2.getVal(ver, 'Ver')));
    return box;
  }

  function selectionCard(sec) {
    const det = document.createElement('details'); det.className = 'sel';
    det.dataset.search = ((DA2.getVal(sec, 'DN') || '') + ' #' + sec.attrs.S).toLowerCase();
    const p1 = sec.pairs.find(p => p.key === 'P1');
    det.innerHTML = `<summary><b>#${sec.attrs.S}</b> ${DA2.getVal(sec, 'DN') || '(ohne Name)'} <em>${p1 ? euro(p1.value) : ''}</em></summary>`;
    const head = document.createElement('div'); head.className = 'friendly';
    const dn = sec.pairs.find(p => p.key === 'DN'); if (dn) head.append(input(dn, { label: 'Anzeigename', wide: true, section: 'VMCSel' }));
    ['P1', 'P2', 'P3', 'P4'].forEach(k => { const p = sec.pairs.find(x => x.key === k); if (p) head.append(input(p, { label: 'Preis ' + k.slice(1), euro: true, section: 'VMCSel' })); });
    det.append(head);
    const grid = document.createElement('div'); grid.className = 'grid expert-only';
    const skip = ['DN', 'P1', 'P2', 'P3', 'P4']; if (sec.items.length) skip.push('AD');
    sec.pairs.forEach(p => { if (!skip.includes(p.key)) grid.append(input(p, { section: 'VMCSel' })); });
    det.append(grid);
    if (sec.items.length) det.append(buildRecipe(sec));
    return det;
  }

  // Rezept als ziehbare Gantt-Zeitachse. D = Start (Verzögerung), T = Dauer, in dsec.
  function buildRecipe(sec) {
    const wrap = document.createElement('div'); wrap.className = 'items';
    wrap.innerHTML = '<strong>Rezept — Zeitachse</strong> <small>Balken ziehen = Start (D) · rechter Rand = Dauer (T) · grau = Vorlauf (AD), in dsec</small>';
    const ad = sec.pairs.find(p => p.key === 'AD');
    const lead = () => ad ? Number(ad.value || 0) : 0;
    // Gerätecode X → Name: X<10 = Produkt-Motor (PN{X}); 2x = Mahlwerk, 3x = Mixer, 6x = Wasser.
    const gSec = DA2.findSection(model, 'VMCGen');
    const devName = xv => {
      const x = Number(xv); if (!isFinite(x)) return 'Gerät';
      if (x < 10) { const nm = gSec && DA2.getVal(gSec, 'PN' + x); return (nm && !/not used|nicht benutzt/i.test(nm)) ? nm : ('Produkt ' + x); }
      const t = Math.floor(x / 10), o = x % 10;
      if (t === 2) return o > 1 ? 'Mahlwerk ' + o : 'Mahlwerk';
      if (t === 3) return 'Mixer ' + o;
      if (t === 6) return 'Wasser ' + o;
      return 'Gerät ' + x;
    };
    const steps = sec.items.map(it => ({ it, d: it.pairs.find(p => p.key === 'D'), t: it.pairs.find(p => p.key === 'T'), x: it.pairs.find(p => p.key === 'X') }));
    const total = () => { const L = lead(); let m = 10; steps.forEach(s => { const e = L + Number(s.d && s.d.value || 0) + Number(s.t && s.t.value || 0); if (e > m) m = e; }); return m * 1.08; };
    let adBar = null, adLab = null;
    const tl = document.createElement('div'); tl.className = 'timeline';
    const ruler = document.createElement('div'); ruler.className = 'ruler';
    const syncMap = new Map();

    function redraw() {
      const T = total(), L = lead();
      if (adBar) { adBar.style.left = '0%'; adBar.style.width = (Math.max(L, 0.3) / T * 100) + '%'; adLab.textContent = 'AD ' + L; }
      steps.forEach(s => {
        const d = Number(s.d && s.d.value || 0), dur = Number(s.t && s.t.value || 0);
        s.bar.style.left = ((L + d) / T * 100) + '%';
        s.bar.style.width = (Math.max(dur, 0.3) / T * 100) + '%';
        s.lab.textContent = (s.x ? devName(s.x.value) + ' · ' : '') + (L + d) + '→' + (L + d + dur);
      });
      ruler.textContent = '0 … ' + Math.round(T) + ' dsec  (1 dsec = 0,1 s)';
    }
    const drag = (el, step, field, stopProp) => {
      el.addEventListener('pointerdown', e => {
        if (stopProp) e.stopPropagation(); else if (e.target.classList.contains('handle')) return;
        e.preventDefault(); el.setPointerCapture(e.pointerId);
        const tw = step.track.clientWidth, T = total(), x0 = e.clientX, v0 = Number(field.value || 0);
        const mv = ev => { let nv = Math.round(v0 + (ev.clientX - x0) / tw * T); if (nv < 0) nv = 0; field.value = String(nv); const inp = syncMap.get(field); if (inp) inp.value = field.value; redraw(); };
        const up = () => { el.releasePointerCapture(e.pointerId); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
    };
    if (ad) {
      const row = document.createElement('div'); row.className = 'trow';
      const lbl = document.createElement('span'); lbl.className = 'tlabel'; lbl.textContent = 'Vorlauf';
      const track = document.createElement('div'); track.className = 'track';
      const bar = document.createElement('div'); bar.className = 'bar adbar';
      const lab = document.createElement('span'); lab.className = 'lab';
      bar.append(lab); track.append(bar); row.append(lbl, track); tl.append(row);
      adBar = bar; adLab = lab;
    }
    steps.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'trow';
      const lbl = document.createElement('span'); lbl.className = 'tlabel'; lbl.textContent = s.x ? devName(s.x.value) : ('#' + (i + 1));
      const track = document.createElement('div'); track.className = 'track';
      const bar = document.createElement('div'); bar.className = 'bar';
      bar.style.background = `hsl(${(Number(s.x && s.x.value || i) * 47) % 360} 55% 45%)`;
      const lab = document.createElement('span'); lab.className = 'lab';
      const handle = document.createElement('span'); handle.className = 'handle';
      bar.append(lab, handle); track.append(bar); row.append(lbl, track); tl.append(row);
      s.bar = bar; s.lab = lab; s.track = track;
      if (s.d) drag(bar, s, s.d, false);
      if (s.t) drag(handle, s, s.t, true);
    });
    // Ablauf-Simulation (da2): Zeit-Cursor + aktive Schritte leuchten.
    tl.style.position = 'relative';
    const cursor = document.createElement('div'); cursor.className = 'playcursor'; cursor.style.display = 'none'; tl.append(cursor);
    const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'playbtn'; playBtn.textContent = '▶ Ablauf abspielen';
    let raf = null, playing = false;
    const stopPlay = () => { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; cursor.style.display = 'none'; steps.forEach(s => s.bar.classList.remove('playing')); playBtn.textContent = '▶ Ablauf abspielen'; };
    const play = () => {
      if (playing) { stopPlay(); return; }
      if (!steps.length) return;
      playing = true; playBtn.textContent = '⏸ Stopp'; cursor.style.display = 'block';
      const T = total(), tr = steps[0].track, Lx = tr.offsetLeft, W = tr.clientWidth, dur = Math.max(2000, T * 90), t0 = performance.now(), L = lead();
      const run = now => {
        if (!playing) return;
        const frac = (now - t0) / dur; if (frac >= 1) { stopPlay(); return; }
        const t = frac * T; cursor.style.left = (Lx + frac * W) + 'px';
        steps.forEach(s => { const del = Number(s.d && s.d.value || 0), z = Number(s.t && s.t.value || 0); s.bar.classList.toggle('playing', z > 0 && t >= L + del && t <= L + del + z); });
        raf = requestAnimationFrame(run);
      };
      raf = requestAnimationFrame(run);
    };
    playBtn.addEventListener('click', play);
    wrap.append(playBtn, tl, ruler);

    const grid = document.createElement('div'); grid.className = 'grid expert-only';
    if (ad) { const w = input(ad, { section: 'VMCSel', label: 'Vorlauf AD [dsec]' }); w.querySelector('input').addEventListener('input', redraw); grid.append(w); }
    steps.forEach(s => s.it.pairs.forEach(p => {
      const w = input(p, { section: 'I' });
      if (p === s.d || p === s.t) { const el = w.querySelector('input'); syncMap.set(p, el); el.addEventListener('input', redraw); }
      grid.append(w);
    }));
    wrap.append(grid);
    redraw();
    return wrap;
  }

  // Freundliche Allgemein-Sektion (da2): bekannte Felder aus VMCGen/VMCAdv/VMCPay mit Klartext + Slider/Select.
  function da2Allgemein() {
    const g = DA2.findSection(model, 'VMCGen'), adv = DA2.findSection(model, 'VMCAdv'), pay = DA2.findSection(model, 'VMCPay');
    if (!g && !adv && !pay) return null;
    const det = document.createElement('details'); det.open = true; det.dataset.search = 'allgemein temperatur sprache zahlsystem zucker lüfter';
    det.innerHTML = '<summary>⚙️ Allgemein</summary>';
    const grid = document.createElement('div'); grid.className = 'friendly';
    const add = (sec, key, opts) => { if (!sec) return; const p = sec.pairs.find(x => x.key === key); if (p) grid.append(input(p, Object.assign({ section: sec.tag }, opts))); };
    add(g, 'MN', { label: 'Maschinenname', wide: true });
    add(g, 'MC', { label: 'Machine Code' });
    add(adv, 'TE', { label: 'Temp Espresso/Boiler', slider: true, unit: ' °C', min: 0, max: 95 });
    add(adv, 'TS', { label: 'Temp Instant/Druckboiler', slider: true, unit: ' °C', min: 0, max: 110 });
    add(adv, 'TR', { label: 'Temp Brühkammer', slider: true, unit: ' °C', min: 0, max: 40 });
    add(adv, 'TC', { label: 'Temp Kalt', slider: true, unit: ' °C', min: 0, max: 15 });
    add(adv, 'FT', { label: 'Lüfterzeit (min)' });
    add(adv, 'L', { label: 'Sprache' });
    add(pay, 'PayType', { label: 'Zahlsystem', enum: (SCH && SCH.payType) || PAYTYPE });
    add(pay, 'NDec', { label: 'Nachkommastellen', enum: { 0: 'keine', 1: '1 Stelle', 2: '2 Stellen', 3: '3 Stellen' } });
    det.append(grid);
    return det;
  }

  function globalSection(sec) {
    const det = document.createElement('details'); det.className = 'expert-only'; det.dataset.search = sec.tag.toLowerCase();
    det.innerHTML = `<summary>${sec.tag} <em>${sec.pairs.length} Parameter</em></summary>`;
    const grid = document.createElement('div'); grid.className = 'grid';
    sec.pairs.forEach(p => grid.append(input(p, { section: sec.tag })));
    det.append(grid);
    return det;
  }

  function renderEditor() {
    const root = $('#sections'); root.innerHTML = ''; root.append(overview());
    const alg = da2Allgemein(); if (alg) root.append(alg);
    const sels = model.sections.filter(s => s.tag === 'VMCSel');
    if (sels.length) { const h = document.createElement('h2'); h.textContent = '☕ Getränke / Auswahlen (' + sels.length + ')'; root.append(h); sels.forEach(s => root.append(selectionCard(s))); }
    const h2 = document.createElement('h2'); h2.textContent = '⚙️ Globale Einstellungen'; h2.className = 'expert-only'; root.append(h2);
    model.sections.filter(s => s.tag !== 'VMCSel').forEach(s => root.append(globalSection(s)));
    applyMode();
  }

  // Read-only-Inspektor (Namenstabellen + Strings + Hex), von beiden Binär-Views genutzt.
  function appendInspector(root, bytes, det) {
    BinFormat.tables(bytes, det).forEach(tb => {
      const d = document.createElement('details');
      d.innerHTML = `<summary>${tb.name} — ${tb.rows.length} Einträge @0x${tb.off.toString(16)}</summary>`;
      const g = document.createElement('div'); g.className = 'grid';
      tb.rows.forEach(r => { const w = document.createElement('label'); w.className = 'kv'; const sp = document.createElement('span'); sp.textContent = '0x' + r.off.toString(16); const i = document.createElement('input'); i.value = r.text; i.disabled = true; w.append(sp, i); g.append(w); });
      d.append(g); root.append(d);
    });
    const strs = BinFormat.strings(bytes, 3).filter(s => /[A-Za-z]{3}/.test(s.text));
    const sd = document.createElement('details');
    sd.innerHTML = `<summary>Klartext-Strings (${strs.length})</summary>`;
    const sg = document.createElement('div'); sg.className = 'grid';
    strs.slice(0, 200).forEach(s => { const d = document.createElement('div'); d.className = 'strrow'; d.textContent = '0x' + s.off.toString(16).padStart(4, '0') + '  ' + s.text; sg.append(d); });
    sd.append(sg); root.append(sd);
    const hd = document.createElement('details');
    hd.innerHTML = `<summary>Hex-Dump (${det.size} B)</summary>`;
    const pre = document.createElement('pre'); pre.className = 'hex'; pre.textContent = BinFormat.hex(bytes);
    hd.append(pre); root.append(hd);
    applyMode();
  }

  function renderBinary(name, bytes, det) {
    model = null; binBuf = null; $('#save').disabled = true;
    const root = $('#sections'); root.innerHTML = '';
    const box = document.createElement('div'); box.className = 'overview';
    box.innerHTML = `<div><span>Datei</span><strong>${name}</strong></div><div><span>Format</span><strong>${det.label}</strong></div><div><span>Größe</span><strong>${det.size} B</strong></div><div><span>Status</span><strong>nur Lesen</strong></div>`;
    root.append(box);
    const note = document.createElement('p'); note.className = 'binnote';
    note.innerHTML = 'Binärformat — <b>Inspektion (read-only)</b>. Editieren folgt, sobald die Feld-Offsets dieses Formats dekodiert sind (siehe <code>docs/06</code>). Zum Ändern bitte noch das Original-rheAction nutzen.';
    root.append(note);
    appendInspector(root, bytes, det);
  }

  // Editierbarer View fürs 3500-„alte .dat"-Format (nur verifizierte Felder, Auto-Checksumme).
  // Ein Eingabefeld für ein Classic-.dat-Feld {off,type,len?,label,euro?}. Live-Checksumme + € + Validierung.
  function datInput(buf, f, MOD) {
    const ndecF = MOD.globals.find(g => g.key === 'ndec');
    const nd = () => ndecF ? (MOD.get(buf, ndecF) || 0) : 0;
    const wrap = document.createElement('label'); wrap.className = 'kv'; if (f.type === 'str' && !f.display) wrap.classList.add('wide');
    if (f.display) wrap.classList.add('displayline');
    const span = document.createElement('span'); span.innerHTML = f.label + (f.sub ? ' <em>' + f.sub + '</em>' : '') + (expert && f.off != null ? '  <small>@0x' + f.off.toString(16) + '</small>' : '');
    const inp = document.createElement('input');
    if (f.type === 'str' && f.len) { inp.maxLength = f.len; inp.setAttribute('maxlength', f.len); }
    const ckUpd = () => { const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)'; };
    if (f.euro) {
      wrap.classList.add('wide-half');
      inp.inputMode = 'decimal';
      inp.value = (MOD.get(buf, f) / Math.pow(10, nd())).toLocaleString('de-DE', { minimumFractionDigits: nd(), maximumFractionDigits: nd() });
      inp.addEventListener('input', () => { const v = parseFloat(inp.value.replace(/\./g, '').replace(',', '.')); const raw = Math.round((isFinite(v) ? v : 0) * Math.pow(10, nd())); MOD.set(buf, f, raw < 0 ? 0 : raw); ckUpd(); });
      const unit = document.createElement('span'); unit.className = 'unit'; unit.textContent = '€';
      const field = document.createElement('div'); field.className = 'eurofield'; field.append(inp, unit);
      wrap.append(span, field);
    } else if (f.hhmm) {
      const t = document.createElement('input'); t.type = 'time';
      const raw0 = MOD.get(buf, f) || 0;
      t.value = String(Math.floor(raw0 / 100)).padStart(2, '0') + ':' + String(raw0 % 100).padStart(2, '0');
      t.addEventListener('input', () => { const p = (t.value || '0:0').split(':'); const v = (parseInt(p[0], 10) || 0) * 100 + (parseInt(p[1], 10) || 0); MOD.set(buf, f, v); ckUpd(); });
      wrap.append(span, t);
    } else if (f.enum) {
      const sel = document.createElement('select'); sel.className = 'enumsel';
      const cur = String(MOD.get(buf, f));
      let has = false;
      for (const k in f.enum) { const o = document.createElement('option'); o.value = k; o.textContent = k + ' · ' + f.enum[k]; if (k === cur) { o.selected = true; has = true; } sel.append(o); }
      if (!has) { const o = document.createElement('option'); o.value = cur; o.textContent = cur + ' · (?)'; o.selected = true; sel.append(o); }
      sel.addEventListener('change', () => { MOD.set(buf, f, sel.value); ckUpd(); });
      wrap.append(span, sel);
    } else if (f.slider) {
      const mn = f.min != null ? f.min : 0, mx = f.max != null ? f.max : 255;
      const r = document.createElement('input'); r.type = 'range'; r.min = mn; r.max = mx; r.value = MOD.get(buf, f);
      const out = document.createElement('output'); out.className = 'sliderval'; out.textContent = MOD.get(buf, f) + (f.unit || '');
      r.addEventListener('input', () => { MOD.set(buf, f, r.value); out.textContent = r.value + (f.unit || ''); ckUpd(); });
      const field = document.createElement('div'); field.className = 'sliderfield'; field.append(r, out);
      wrap.append(span, field);
    } else {
      inp.value = MOD.get(buf, f);
      inp.addEventListener('input', () => { MOD.set(buf, f, inp.value); ckUpd(); });
      if (f.unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = f.unit.trim(); const fld = document.createElement('div'); fld.className = 'eurofield'; fld.append(inp, u); wrap.append(span, fld); }
      else wrap.append(span, inp);
    }
    return wrap;
  }

  function countSelections(buf, MOD) {
    let c = 0;
    for (let i = 0; i < 24; i++) { const b = buf[MOD.nameTable + i * MOD.nameStride]; if (b >= 32 && b < 127) c++; else break; }
    return Math.max(1, c);
  }

  // Rezept-Zeitachse (Gantt) fürs Classic-.dat: Geräte-Lanes, ziehbare Balken, Behälter-Legende.
  const PALETTE = ['#e8502a', '#20b8c8', '#e0b020', '#3fb950', '#a65fe0', '#3f6fe8', '#e86aa0', '#8b8f98'];
  function buildDatRecipe(buf, MOD, base) {
    const wrap = document.createElement('div'); wrap.className = 'items';
    wrap.innerHTML = '<strong>Rezept — Zeitachse</strong> <small>Balken ziehen = Start · rechter Rand = Dauer (dsec)</small>';

    // Behälter-Legende (Zutaten-Namen aus Produkttabelle)
    if (MOD.productTable != null) {
      const leg = document.createElement('div'); leg.className = 'legend';
      for (let i = 0; i < 10; i++) {
        const raw = MOD.get(buf, { off: MOD.productTable + i * MOD.productStride, type: 'str', len: MOD.productLen });
        if (!raw) break; const nm = raw.replace(/\s*\[.*$/, '').trim(); if (/not used|nicht benutzt/i.test(nm) || !nm) continue;
        const item = document.createElement('span'); item.className = 'legitem';
        item.innerHTML = `<i class="sw" style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(nm)}`;
        leg.append(item);
      }
      if (leg.children.length) { const cap = document.createElement('div'); cap.className = 'legcap'; cap.textContent = 'Behälter / Zutaten:'; wrap.append(cap, leg); }
    }

    const dispNm = s => (s || '').replace(/\s*\[.*$/, '').trim();
    const contName = c => MOD.productTable != null ? dispNm(MOD.get(buf, { off: MOD.productTable + c * MOD.productStride, type: 'str', len: MOD.productLen })) : '';
    const used = nm => nm && !/not used|nicht benutzt/i.test(nm);
    const devs = [];
    // Produkt-Lanes: Behälter c @ base + c*3 (dekodiert, docs/16 §6c)
    const R = MOD.recipe || {};
    const nProd = R.products || Math.floor(MOD.recordStride / 3);
    for (let c = 0; c < nProd; c++) {
      const o = base + c * 3; if (buf[o] <= 0) continue;
      const nm = contName(c);
      devs.push({ off: o, name: used(nm) ? nm : 'Gerät ' + (c + 1), color: PALETTE[c % PALETTE.length], slot: c, zeitF: { off: o, type: 'u8' }, delF: { off: o + 1, type: 'u8' } });
    }
    // Mixer-Lanes: physischer Mixer m → Wasser/Mixer-Tripel (nur belegte)
    if (R.ventilBase != null) {
      const mN = Math.min((MOD.mixerCountOff != null ? buf[MOD.mixerCountOff] : 0) || R.mixers || 4, R.mixers || 4);
      for (let m = 1; m <= mN; m++) {
        const wb = base + R.ventilBase + (m - 1) * R.ventilStride, mb = wb + 3;
        if (buf[wb] > 0) devs.push({ off: wb, name: 'Mixer ' + m + ' · Wasser', color: '#3f6fe8', mixerWater: m, zeitF: { off: wb, type: 'u8' }, delF: { off: wb + 1, type: 'u8' } });
        if (buf[mb] > 0) devs.push({ off: mb, name: 'Mixer ' + m + ' · Mix', color: '#a65fe0', mixerMix: m, zeitF: { off: mb, type: 'u8' }, delF: { off: mb + 1, type: 'u8' } });
      }
    }
    const tl = document.createElement('div'); tl.className = 'timeline';
    const ruler = document.createElement('div'); ruler.className = 'ruler';
    const total = () => { let m = 10; devs.forEach(x => { const e = (x.delF ? MOD.get(buf, x.delF) : 0) + MOD.get(buf, x.zeitF); if (e > m) m = e; }); return m * 1.1; };
    function redraw() {
      const T = total();
      devs.forEach(x => { const del = x.delF ? MOD.get(buf, x.delF) : 0, z = MOD.get(buf, x.zeitF);
        x.bar.style.left = (del / T * 100) + '%'; x.bar.style.width = (Math.max(z, 0.5) / T * 100) + '%';
        x.lab.textContent = del + '→' + (del + z); });
      ruler.textContent = '0 … ' + Math.round(T) + ' dsec';
    }
    const touchCk = () => { const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)'; };
    const drag = (el, x, field, stop) => el.addEventListener('pointerdown', e => {
      if (stop) e.stopPropagation(); else if (e.target.classList.contains('handle')) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const tw = x.track.clientWidth, T = total(), x0 = e.clientX, v0 = MOD.get(buf, field);
      const mv = ev => { let nv = Math.round(v0 + (ev.clientX - x0) / tw * T); if (nv < 0) nv = 0; if (nv > 255) nv = 255; MOD.set(buf, field, nv); touchCk(); redraw(); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    devs.forEach(x => {
      const row = document.createElement('div'); row.className = 'trow';
      const lbl = document.createElement('span'); lbl.className = 'tlabel'; lbl.textContent = x.name;
      const track = document.createElement('div'); track.className = 'track';
      const bar = document.createElement('div'); bar.className = 'bar'; bar.style.background = x.color;
      const lab = document.createElement('span'); lab.className = 'lab';
      const handle = document.createElement('span'); handle.className = 'handle';
      bar.append(lab, handle); track.append(bar); row.append(lbl, track); tl.append(row);
      x.bar = bar; x.lab = lab; x.track = track;
      if (x.delF) drag(bar, x, x.delF, false);
      drag(handle, x, x.zeitF, true);
    });
    // Ablauf-Simulation: Zeit-Cursor läuft über die Zeitachse, aktive Behälter/Mixer leuchten.
    tl.style.position = 'relative';
    const cursor = document.createElement('div'); cursor.className = 'playcursor'; cursor.style.display = 'none'; tl.append(cursor);
    const playBtn = document.createElement('button'); playBtn.type = 'button'; playBtn.className = 'playbtn'; playBtn.textContent = '▶ Ablauf abspielen';
    let raf = null, playing = false;
    // Behälter-Karten / Mixer-Stationen in der Behälter-Ansicht (gleicher #sections-DOM) animieren.
    const clearAnim = () => {
      document.querySelectorAll('.contcard.anim').forEach(c => c.classList.remove('anim'));
      document.querySelectorAll('.stat.mixing, .stat.watering').forEach(s => s.classList.remove('mixing', 'watering'));
    };
    const stopPlay = () => { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; cursor.style.display = 'none'; devs.forEach(x => x.bar.classList.remove('playing')); clearAnim(); playBtn.textContent = '▶ Ablauf abspielen'; };
    const play = () => {
      if (playing) { stopPlay(); return; }
      if (!devs.length) return;
      playing = true; playBtn.textContent = '⏸ Stopp'; cursor.style.display = 'block';
      const T = total(), tr = devs[0].track, L = tr.offsetLeft, W = tr.clientWidth, dur = Math.max(2000, T * 90), t0 = performance.now();
      const step = now => {
        if (!playing) return;
        const frac = (now - t0) / dur;
        if (frac >= 1) { stopPlay(); return; }
        const t = frac * T;
        cursor.style.left = (L + frac * W) + 'px';
        const waterMix = new Set(), spinMix = new Set();
        devs.forEach(x => {
          const del = x.delF ? MOD.get(buf, x.delF) : 0, z = MOD.get(buf, x.zeitF);
          const on = z > 0 && t >= del && t <= del + z;
          x.bar.classList.toggle('playing', on);
          if (x.slot != null) { const card = document.querySelector('.contcard[data-slot="' + x.slot + '"]'); if (card) card.classList.toggle('anim', on); }  // Pulver rieselt
          if (on && x.mixerWater != null) waterMix.add(x.mixerWater);  // Wasser fließt in diesen Mixer
          if (on && x.mixerMix != null) spinMix.add(x.mixerMix);       // Quirl dreht in diesem Mixer
        });
        document.querySelectorAll('.stat[data-mixer]').forEach(st => {
          const m = +st.dataset.mixer;
          st.classList.toggle('watering', waterMix.has(m));
          st.classList.toggle('mixing', spinMix.has(m));
        });
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    playBtn.addEventListener('click', play);
    wrap.append(playBtn, tl, ruler);

    const grid = document.createElement('div'); grid.className = 'grid expert-only';
    devs.forEach(x => {
      grid.append(datInput(buf, { off: x.off, type: 'u8', label: x.name + ' Zeit' }, MOD));
      grid.append(datInput(buf, { off: x.off + 1, type: 'u8', label: x.name + ' Verzög.' }, MOD));
      grid.append(datInput(buf, { off: x.off + 2, type: 'u8', label: x.name + ' Pause' }, MOD));
    });
    wrap.append(grid);
    redraw();
    return wrap;
  }

  const isLocked = nm => !nm || !nm.trim() || /gesperrt|not used|nicht benutzt|locked/i.test(nm);
  const selLocked = (buf, MOD, idx, nm) => (MOD.statusOff != null) ? (buf[MOD.recordStart + idx * MOD.recordStride + MOD.statusOff] === (MOD.statusLockedVal != null ? MOD.statusLockedVal : 0)) : isLocked(nm);

  const esc = s => String(s).replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

  // Behälter-Konfigurations-Grafik (SVG): Behälter oben, darunter Brüher (Kaffee) + Mixer (Pulver).
  // Zuordnung ist schematisch per Namensheuristik — die echte Behälter→Station-Route ist (noch) nicht aus der Konfig gelesen.
  function containerSVG(names) {
    const boxW = 60, gap = 14, startX = 16, topY = 28, boxH = 92;
    const W = startX * 2 + names.length * boxW + Math.max(0, names.length - 1) * gap;
    const isCoffee = s => /kaffee|coffee|espress|bohne|\bbean|crema|ristr|mok|mocc|caf[eé]/i.test(s);
    let boxes = '';
    const cont = names.map((n, i) => {
      const x = startX + i * (boxW + gap), cx = x + boxW / 2, mid = topY + boxH / 2 + 6;
      boxes += `<rect x="${x}" y="${topY}" width="${boxW}" height="${boxH}" rx="6" style="fill:var(--panel2);stroke:var(--line)"/>`;
      boxes += `<rect x="${x}" y="${topY}" width="${boxW}" height="9" rx="4" style="fill:${n.color}"/>`;
      boxes += `<text x="${cx}" y="${mid}" transform="rotate(-90 ${cx} ${mid})" text-anchor="middle" style="fill:var(--fg)" font-size="12" font-weight="600">${esc(n.nm)}</text>`;
      return { cx, coffee: isCoffee(n.nm) };
    });
    const fy = topY + boxH;
    // Stationen bilden: ein Brüher für alle Kaffee-/Bohnenbehälter, Mixer (zu je ~3 Pulvern) für den Rest.
    const coffees = cont.filter(c => c.coffee), powders = cont.filter(c => !c.coffee);
    const stations = [];
    if (coffees.length) stations.push({ label: 'Brüher', feeders: coffees, brew: true });
    const mixGroups = [];
    for (let k = 0; k < powders.length; k += 3) mixGroups.push(powders.slice(k, k + 3));
    mixGroups.forEach((g, mi) => stations.push({ label: mixGroups.length > 1 ? 'Mixer ' + (mi + 1) : 'Mixer', feeders: g, brew: false }));
    if (!stations.length) stations.push({ label: 'Mixer', feeders: cont, brew: false });
    // Stationen mittig verteilen.
    const sw = 74, sGap = 22, sN = stations.length;
    const totalW = sN * sw + (sN - 1) * sGap;
    const sx0 = Math.max(startX, (W - totalW) / 2);
    const stY = fy + 48, stH = 26;
    let lines = '', sboxes = '';
    stations.forEach((st, si) => {
      const sx = sx0 + si * (sw + sGap), scx = sx + sw / 2;
      st.feeders.forEach(f => { lines += `<path d="M${f.cx} ${fy} L${scx} ${stY}" style="fill:none;stroke:var(--line)" stroke-width="1.5"/>`; });
      sboxes += `<rect x="${sx}" y="${stY}" width="${sw}" height="${stH}" rx="5" style="fill:var(--panel2);stroke:${st.brew ? 'var(--accent)' : 'var(--line)'}"/>`;
      sboxes += `<text x="${scx}" y="${stY + 17}" text-anchor="middle" style="fill:var(--fg)" font-size="12" font-weight="600">${st.label}</text>`;
      sboxes += `<path d="M${scx - 7} ${stY + stH} L${scx + 7} ${stY + stH} L${scx + 3} ${stY + stH + 14} L${scx - 3} ${stY + stH + 14} Z" style="fill:var(--accent)"/>`;
    });
    const H = stY + stH + 22;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">` +
      `<text x="${startX}" y="18" style="fill:var(--muted)" font-size="12">${names.length} Produktbehälter · schematisch</text>` +
      lines + boxes + sboxes + `</svg>`;
  }

  // Zutaten/Behälter: Grafik + editierbare Namen.
  function buildContainers(buf, MOD) {
    if (MOD.productTable == null) return null;
    // Rich-View „Schritt 2" (Group 1 + Motoren + Routing) nur bei verifizierten Routing-Metadaten (8192).
    if (MOD.routingTable != null && MOD.mixerCountOff != null) return buildContainerConfig(buf, MOD);
    // Fallback: altes Schema-Diagramm (z. B. 3500).
    const slots = [], names = [];
    for (let i = 0; i < 12; i++) {
      const off = MOD.productTable + i * MOD.productStride;
      const nm = (MOD.get(buf, { off, type: 'str', len: MOD.productLen }) || '').trim();
      if (!nm && i >= 1) break;
      if (/\[/.test(nm)) continue; // Schritt-Label, kein Behälter
      slots.push({ i, off, nm });
      if (nm && !/not used|benutzt/i.test(nm)) names.push({ nm, color: PALETTE[i % PALETTE.length] });
    }
    if (!slots.length) return null;
    const det = document.createElement('details'); det.open = true;
    det.innerHTML = '<summary>🧃 Behälter / Zutaten</summary>';
    if (names.length) { const g = document.createElement('div'); g.className = 'graphicbox'; g.innerHTML = containerSVG(names); det.append(g); }
    const grid = document.createElement('div'); grid.className = 'friendly expert-only';
    slots.forEach(s => grid.append(datInput(buf, { off: s.off, type: 'str', len: MOD.productLen, label: 'Behälter ' + (s.i + 1) }, MOD)));
    det.append(grid);
    return det;
  }

  // Behälter-Becher: saubere einzelne Füllung (keine Lücke), unten gefärbt.
  function beakerSVG(color, muted) {
    const fill = muted ? 'var(--line)' : color, op = muted ? 0.4 : 1;
    const id = 'bk' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 44 58" width="44" height="58" aria-hidden="true">` +
      `<clipPath id="${id}"><rect x="4" y="3" width="36" height="52" rx="7"/></clipPath>` +
      `<rect x="4" y="3" width="36" height="52" rx="7" style="fill:var(--panel)"/>` +
      `<rect x="4" y="24" width="36" height="31" style="fill:${fill};opacity:${op}" clip-path="url(#${id})"/>` +
      `<rect x="4" y="3" width="36" height="52" rx="7" style="fill:none;stroke:var(--line);stroke-width:1.5"/></svg>`;
  }

  // Symbolische Rutsche, die in die Knopf-Richtung zeigt (0=rechts,1=unten,2=links,3=oben).
  const DIRN = ['rechts', 'unten', 'links', 'oben'];
  function chuteSVG(color, dir, muted) {
    const c = muted ? 'var(--line)' : color;
    // Trichter oben + Rutsche/Pfeil in die jeweilige Richtung.
    const arm = {
      0: 'M18 16 L32 16 M26 10 L33 16 L26 22',
      1: 'M18 16 L18 28 M12 22 L18 29 L24 22',
      2: 'M18 16 L4 16 M10 10 L3 16 L10 22',
      3: 'M18 16 L18 5 M12 11 L18 4 L24 11',
    }[dir] || '';
    return `<svg viewBox="0 0 36 32" width="34" height="30" aria-hidden="true">` +
      `<path d="M8 3 L28 3 L21 13 L15 13 Z" style="fill:${c};opacity:${muted ? 0.3 : 0.8}"/>` +
      `<path d="${arm}" style="fill:none;stroke:${c};stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"/></svg>`;
  }

  // Förderschnecke/Auger: Spiral-Symbol, das sich im Behälter-Auslauf dreht (CSS @keyframes spin, Farbe = var(--cc)).
  function augerSVG() {
    return `<svg class="augersvg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">` +
      `<path d="M12 3 A9 9 0 1 1 3 12 A6 6 0 1 1 12 6 A3 3 0 1 1 9 12" style="fill:none;stroke:var(--cc,var(--accent));stroke-width:2.2;stroke-linecap:round"/></svg>`;
  }

  // Behälter-Konfiguration „Schritt 2" (hersteller-nah): Motor N + verifiziertes Behälter→Mixer-Routing (docs/16 §6b).
  // routing[Slot i] = routingTable + i; Wert = Mixer-Index (0-basiert). „Group 1" nur bei PressoBean (erster Slot = Brüher-Gruppe).
  function buildContainerConfig(buf, MOD) {
    const tbl = MOD.productTable, stride = MOD.productStride;
    const mixerN = Math.max(1, buf[MOD.mixerCountOff] || 1);
    const nActive = Math.min(16, buf[MOD.containerCountOff] || 0);  // Group (falls PB) + aktive Motoren
    const nameOf = i => (MOD.get(buf, { off: tbl + i * stride, type: 'str', len: MOD.productLen }) || '');
    const inactive = s => !s.trim() || /not used|nicht benutzt/i.test(s);
    const disp = s => s.replace(/\s*\[.*$/, '').trim();
    const ckUpd = () => { const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)'; };
    const routeOffOf = i => MOD.routingTable + i * MOD.routingStride;
    // PressoBean: erster Slot ist die Wasser-/Espresso-Gruppe (→ Brüher). SpeedMix: alle sind Motoren.
    const hasGroup = /water\s*co|espress|bohne|bean|crema/i.test(nameOf(0));
    const motorLabel = i => hasGroup ? (i === 0 ? 'Group 1' : 'Motor ' + i) : ('Motor ' + (i + 1));

    // Sichtbare Slots: bis 10, hintere leere über der aktiven Grenze abschneiden.
    let nShown = 10; while (nShown > Math.max(1, nActive) && !nameOf(nShown - 1).trim()) nShown--;
    const slots = Array.from({ length: nShown }, (_, i) => i);
    const isGroupSlot = i => hasGroup && i === 0;
    const unused = i => i >= nActive;   // über die Modulzahl hinaus = ausgegraut/ungenutzt

    const det = document.createElement('details'); det.open = true;
    det.innerHTML = '<summary>🧃 Behälter-Konfiguration <em>(Behälter → physischer Mixer · Rutsche klickbar)</em></summary>';
    const head = document.createElement('div'); head.className = 'conthead';
    head.innerHTML = `<span>Mixer/Elektroventile <b>@0x${MOD.mixerCountOff.toString(16)}</b> = <b>${mixerN}</b></span>` +
      `<span>aktive Module <b>@0x${MOD.containerCountOff.toString(16)}</b> = <b>${nActive}</b></span>` +
      `<span class="hint">${hasGroup ? 'PressoBean: Group 1 = Brüher · ' : ''}Mixer-Nummer = physisches Ventil (wie im Rezept). Rutsche klicken = umlenken.</span>`;
    det.append(head);

    const row = document.createElement('div'); row.className = 'contscroll';
    const sumWrap = document.createElement('div'); sumWrap.className = 'stationsum';

    // Geometrie: der Mixer sitzt UNTER einem Behälter. „unten"(1)=eigener Mixer, „rechts"(0)=Nachbar rechts (+1),
    // „links"(2)=Nachbar links (−1). Die Lücken-Position = PHYSISCHE Mixer-Nummer (= „Ventil N" im Rezept, verifiziert:
    // Chocolate→4, Tea→3, Coffee→1). So teilen sich Behälter mit gleicher Position denselben physischen Mixer.
    const mixerX = i => { const b = buf[routeOffOf(i)]; return i + (b === 0 ? 1 : b === 2 ? -1 : 0); };
    const physMixer = i => Math.min(mixerN, Math.max(1, mixerX(i)));
    const cardRefs = [];
    function refresh() {
      cardRefs.forEach(ref => {
        const v = buf[routeOffOf(ref.i)] & 3;
        ref.chute.innerHTML = chuteSVG(ref.color, v, false);
        ref.rt.textContent = '→ Mixer ' + physMixer(ref.i);
      });
      const groups = {}; for (let m = 1; m <= mixerN; m++) groups[m] = [];
      const bruher = [];
      slots.forEach(i => {
        if (unused(i) || inactive(nameOf(i))) return;
        if (isGroupSlot(i)) { bruher.push(disp(nameOf(i))); return; }
        groups[physMixer(i)].push(disp(nameOf(i)));
      });
      const cell = (title, arr, mixer) => `<div class="stat"${mixer ? ` data-mixer="${mixer}"` : ''}>${mixer ? '<i class="mixwater" aria-hidden="true"></i>' : ''}<b>${mixer ? '<i class="mixspin" aria-hidden="true">⚙</i>' : ''}${title}</b>${arr.map(x => `<span>${esc(x)}</span>`).join('') || '<span class="none">—</span>'}</div>`;
      sumWrap.innerHTML = (hasGroup ? cell('Brüher', bruher) : '') + Array.from({ length: mixerN }, (_, k) => cell('Mixer ' + (k + 1), groups[k + 1], k + 1)).join('');
    }

    slots.forEach(i => {
      const nm = nameOf(i), color = PALETTE[i % PALETTE.length];
      const muted = unused(i) || (inactive(nm) && !isGroupSlot(i));
      const card = document.createElement('div'); card.className = 'contcard' + (muted ? ' muted' : '');
      card.dataset.slot = i;                                  // adressierbar aus der Play-Schleife (Produkt-Lane c → [data-slot=c])
      card.dataset.kind = /wasser|water/i.test(nm) ? 'water' : 'powder';  // nur für optionales Pulver am Auslauf
      card.style.setProperty('--cc', color);                  // Behälterfarbe für die Animation
      const label = document.createElement('div'); label.className = 'contlabel'; label.textContent = motorLabel(i);
      const nameInp = document.createElement('input'); nameInp.className = 'contname'; nameInp.value = disp(nm); nameInp.title = nm + '  (@0x' + (tbl + i * stride).toString(16) + ')';
      nameInp.addEventListener('input', () => { MOD.set(buf, { off: tbl + i * stride, type: 'str', len: MOD.productLen }, nameInp.value); ckUpd(); });
      const bk = document.createElement('div'); bk.className = 'contbeaker'; bk.innerHTML = beakerSVG(color, muted);
      const anim = document.createElement('div'); anim.className = 'contanim'; anim.setAttribute('aria-hidden', 'true'); anim.innerHTML = augerSVG();  // drehende Förderschnecke (nur sichtbar bei .anim)
      card.append(label, nameInp, bk, anim);
      if (isGroupSlot(i)) {
        const r = document.createElement('div'); r.className = 'controute fixed'; r.textContent = '→ Brüher'; card.append(r);
      } else if (muted) {
        const chute = document.createElement('div'); chute.className = 'contchute'; chute.innerHTML = chuteSVG(color, 0, true); card.append(chute);
        const r = document.createElement('div'); r.className = 'controute none'; r.textContent = unused(i) ? 'ungenutzt' : '—'; card.append(r);
      } else {
        const routeOff = routeOffOf(i);
        const chute = document.createElement('div'); chute.className = 'contchute'; chute.title = 'Klicken: Rutsche umlenken (Lücke links/rechts)';
        const rt = document.createElement('div'); rt.className = 'controute';
        chute.addEventListener('click', () => { buf[routeOff] = (buf[routeOff] + 1) % 3; ckUpd(); refresh(); });
        card.append(chute, rt);
        cardRefs.push({ i, color, chute, rt });
      }
      row.append(card);
    });
    det.append(row);
    refresh();
    det.append(sumWrap);
    return det;
  }

  // Excel-artige Preismatrix: Spalten = Preislisten, Zeilen = Getränke, Pfeiltasten-Navigation.
  function buildPriceMatrix(buf, MOD) {
    const selCount = countSelections(buf, MOD);
    const ndecF = MOD.globals.find(g => g.key === 'ndec');
    const nd = () => ndecF ? (MOD.get(buf, ndecF) || 0) : 0;
    const fmt = raw => (raw / Math.pow(10, nd())).toLocaleString('de-DE', { minimumFractionDigits: nd(), maximumFractionDigits: nd() });
    const table = document.createElement('table'); table.className = 'pricematrix';
    const thead = document.createElement('thead'); const hr = document.createElement('tr');
    hr.innerHTML = '<th>Getränk</th>' + MOD.priceTables.map((_, k) => `<th>Preis ${k + 1}<small>${(MOD.priceLabels && MOD.priceLabels[k]) || ''}</small></th>`).join('');
    thead.append(hr); table.append(thead);
    const tbody = document.createElement('tbody');
    for (let r = 0; r < selCount; r++) {
      const tr = document.createElement('tr');
      const nm = MOD.get(buf, { off: MOD.nameTable + r * MOD.nameStride, type: 'str', len: MOD.nameLen }) || ('#' + (r + 1));
      if (selLocked(buf, MOD, r, nm)) tr.className = 'locked';
      const th = document.createElement('th'); th.textContent = nm; tr.append(th);
      MOD.priceTables.forEach((base, c) => {
        const td = document.createElement('td');
        const f = { off: base + r * 2, type: 'u16be' };
        const inp = document.createElement('input'); inp.className = 'cell'; inp.inputMode = 'decimal';
        inp.dataset.r = r; inp.dataset.c = c; inp.value = fmt(MOD.get(buf, f));
        inp.addEventListener('input', () => { const v = parseFloat(inp.value.replace(/\./g, '').replace(',', '.')); MOD.set(buf, f, Math.max(0, Math.round((isFinite(v) ? v : 0) * Math.pow(10, nd())))); const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)'; });
        inp.addEventListener('keydown', e => {
          if (e.key === '+' || e.key === '-') {
            e.preventDefault();
            MOD.set(buf, f, Math.max(0, MOD.get(buf, f) + (e.key === '+' ? 1 : -1)));
            inp.value = fmt(MOD.get(buf, f));
            const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)';
            return;
          }
          let nr = r, nc = c;
          if (e.key === 'ArrowUp') nr--; else if (e.key === 'ArrowDown' || e.key === 'Enter') nr++;
          else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0) nc--;
          else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) nc++;
          else return;
          const next = table.querySelector(`input[data-r="${nr}"][data-c="${nc}"]`);
          if (next) { e.preventDefault(); next.focus(); next.select(); }
        });
        td.append(inp); tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(tbody);
    const det = document.createElement('details'); det.open = true;
    det.innerHTML = '<summary>💶 Preisliste — alle Getränke <em>(Pfeiltasten zum Navigieren)</em></summary>';
    const scroller = document.createElement('div'); scroller.className = 'matrixscroll'; scroller.append(table);
    det.append(scroller);
    return det;
  }

  // Zeitpläne: Happy Hour (Preisermäßigung) + Energiespar je Wochentag, Zeiten als HH:MM (HH*100+MM, u16be).
  // Ein Zeit-Intervall als 24h-Zeitstrahl mit ziehbaren Start/Ende-Griffen + HH:MM-Feldern (Wert = HH*100+MM, u16be).
  function buildTimeRange(label, buf, MOD, startOff, endOff) {
    const ckUpd = () => { const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)'; };
    const F = off => ({ off, type: 'u16be' });
    const getV = off => MOD.get(buf, F(off)) || 0;
    const toMin = v => Math.floor(v / 100) * 60 + (v % 100);
    const minToV = m => { m = Math.max(0, Math.min(1440, Math.round(m / 5) * 5)); return Math.floor(m / 60) * 100 + (m % 60); };
    const fmt = v => String(Math.floor(v / 100)).padStart(2, '0') + ':' + String(v % 100).padStart(2, '0');

    const row = document.createElement('div'); row.className = 'trrow';
    const lbl = document.createElement('div'); lbl.className = 'trlabel'; lbl.textContent = label;
    const track = document.createElement('div'); track.className = 'trtrack';
    const bar = document.createElement('div'); bar.className = 'trbar';
    const hS = document.createElement('div'); hS.className = 'trhandle'; hS.title = 'Start ziehen';
    const hE = document.createElement('div'); hE.className = 'trhandle'; hE.title = 'Ende ziehen';
    track.append(bar, hS, hE);
    const box = document.createElement('div'); box.className = 'trtimes';
    const inS = document.createElement('input'); inS.type = 'time';
    const arrow = document.createElement('span'); arrow.className = 'trarrow'; arrow.textContent = '→';
    const inE = document.createElement('input'); inE.type = 'time';
    box.append(inS, arrow, inE);

    function draw() {
      const s = getV(startOff), e = getV(endOff), sm = toMin(s), em = toMin(e);
      const l = sm / 1440 * 100, r = em / 1440 * 100;
      bar.style.left = l + '%'; bar.style.width = Math.max(0, r - l) + '%';
      hS.style.left = l + '%'; hE.style.left = r + '%';
      inS.value = fmt(s); inE.value = fmt(e);
      row.classList.toggle('empty', s === 0 && e === 0);
    }
    const setMin = (off, m) => { MOD.set(buf, F(off), minToV(m)); ckUpd(); draw(); };
    const drag = (h, off) => h.addEventListener('pointerdown', ev => {
      ev.preventDefault(); h.setPointerCapture(ev.pointerId);
      const rect = track.getBoundingClientRect();
      const mv = e2 => setMin(off, (e2.clientX - rect.left) / rect.width * 1440);
      const up = () => { h.releasePointerCapture(ev.pointerId); h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); mv(ev);
    });
    drag(hS, startOff); drag(hE, endOff);
    const fromInput = (inp, off) => inp.addEventListener('input', () => { const p = (inp.value || '0:0').split(':'); MOD.set(buf, F(off), (+p[0] || 0) * 100 + (+p[1] || 0)); ckUpd(); draw(); });
    fromInput(inS, startOff); fromInput(inE, endOff);
    row.append(lbl, track, box); draw();
    return row;
  }

  function buildZeitplan(buf, MOD) {
    const Z = MOD.zeitplan; if (!Z) return null;
    const det = document.createElement('details'); det.open = false;
    det.innerHTML = '<summary>🕑 Zeitpläne <em>(Happy Hour &amp; Energiespar)</em></summary>';
    const cap = t => { const c = document.createElement('div'); c.className = 'legcap'; c.textContent = t; return c; };
    const ruler = () => { const r = document.createElement('div'); r.className = 'trruler'; r.innerHTML = '<span></span><span class="trmarks"><i>0</i><i>6</i><i>12</i><i>18</i><i>24 h</i></span><span></span>'; return r; };
    det.append(cap('Preisermäßigung / Happy Hour — Start → Ende je Intervall'));
    det.append(ruler());
    for (let i = 0; i < (Z.happyN || 3); i++) det.append(buildTimeRange('Intervall ' + (i + 1), buf, MOD, Z.happy + i * 4, Z.happy + i * 4 + 2));
    det.append(cap('Energiespar — Einschalten → Abschalten je Wochentag (00:00 → 00:00 = aus)'));
    det.append(ruler());
    const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
    for (let i = 0; i < (Z.days || 7); i++) det.append(buildTimeRange(days[i], buf, MOD, Z.energy + i * 4, Z.energy + i * 4 + 2));
    return det;
  }

  function renderDatEditor(name, buf, det, MOD) {
    model = null;
    const root = $('#sections'); root.innerHTML = '';
    const ok = MOD.verify(buf);
    const box = document.createElement('div'); box.className = 'overview expert-only';
    box.innerHTML = `<div><span>Datei</span><strong>${name}</strong></div><div><span>Format</span><strong>${det.label}</strong></div>` +
      `<div><span>Status</span><strong>editierbar</strong></div>` +
      `<div><span>Checksumme @0x0780</span><strong id="ckval">0x${buf[MOD.CK].toString(16)} ${ok ? '✓ passt' : '✗ (wird berechnet)'}</strong></div>`;
    root.append(box);
    const warn = document.createElement('p'); warn.className = 'binnote expert-only';
    warn.innerHTML = 'ⓘ <b>Editierbar:</b> Allgemein-Felder (Temperaturen 1–4, P-Parameter P6–P31), Preise, Namen, Behälter-Routing, Rezept-Zeiten. Die Checksumme wird beim Speichern automatisch korrekt berechnet. Experten-Felder nur im Experten-Modus sichtbar.';
    root.append(warn);

    // Allgemein (global) — Experten-Felder nur im Experten-Modus
    const gh = document.createElement('h2'); gh.textContent = '⚙️ Allgemein'; root.append(gh);
    const gg = document.createElement('div'); gg.className = 'friendly';
    MOD.globals.filter(f => !f.display).forEach(f => { const el = datInput(buf, f, MOD); if (f.expert) el.classList.add('expert-only'); gg.append(el); });
    root.append(gg);
    // Display-Nachricht als eigene kompakte LCD-Card
    const dispF = MOD.globals.filter(f => f.display);
    if (dispF.length) {
      const card = document.createElement('div'); card.className = 'displaycard';
      const cap = document.createElement('div'); cap.className = 'displaycap'; cap.textContent = '📟 Display-Nachricht';
      card.append(cap);
      const lcd = document.createElement('div'); lcd.className = 'lcd';
      dispF.forEach(f => lcd.append(datInput(buf, f, MOD)));
      card.append(lcd); root.append(card);
    }

    // Preisliste (Excel-artige Matrix)
    if (MOD.priceTables && MOD.priceTables.length) {
      const ph0 = document.createElement('h2'); ph0.textContent = '💶 Preisliste'; root.append(ph0);
      root.append(buildPriceMatrix(buf, MOD));
    }

    // Zeitpläne (Happy Hour + Energiespar)
    const zp = buildZeitplan(buf, MOD); if (zp) root.append(zp);

    // Zutaten / Behälter (Namen editierbar) — direkt über den Auswahlen/Rezepten, da als Referenz hilfreich
    const containers = buildContainers(buf, MOD); if (containers) root.append(containers);

    // Auswahl-Wähler
    const selCount = countSelections(buf, MOD);
    const ph = document.createElement('h2'); ph.textContent = '☕ Auswahl / Getränk'; root.append(ph);
    const bar = document.createElement('div'); bar.className = 'selchips';
    const cont = document.createElement('div');
    const chips = [];
    for (let i = 0; i < selCount; i++) {
      const nm = MOD.get(buf, { off: MOD.nameTable + i * MOD.nameStride, type: 'str', len: MOD.nameLen });
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'chip' + (selLocked(buf, MOD, i, nm) ? ' locked' : '');
      chip.innerHTML = `<b>#${i + 1}</b> ${nm || '—'}`;
      chip.addEventListener('click', () => { chips.forEach(c => c.classList.remove('active')); chip.classList.add('active'); renderSel(i); });
      chips.push(chip); bar.append(chip);
    }
    root.append(bar); root.append(cont);

    function renderSel(idx) {
      cont.innerHTML = '';
      if (MOD.statusOff != null) {
        const lockedVal = MOD.statusLockedVal != null ? MOD.statusLockedVal : 0;
        const TYPES = { 0: 'Auswahl aktiv', 1: 'Auswahl gesperrt', 2: 'Vorwahl', 3: 'Vorwahl kalt', 4: 'FBT' };
        const sf = { off: MOD.recordStart + idx * MOD.recordStride + MOD.statusOff, type: 'u8' };
        const sw = document.createElement('label'); sw.className = 'switch activesw';
        const cur = () => MOD.get(buf, sf);
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cur() !== lockedVal;
        const sl = document.createElement('span'); sl.className = 'slider';
        const tx = document.createElement('span'); tx.textContent = TYPES[cur()] || ('Typ ' + cur());
        cb.addEventListener('change', () => {
          MOD.set(buf, sf, cb.checked ? 0 : lockedVal);
          tx.textContent = TYPES[cur()] || ('Typ ' + cur());
          const ck = $('#ckval'); if (ck) ck.textContent = '0x' + MOD.checksum(buf).toString(16) + ' (neu)';
          if (chips[idx]) chips[idx].classList.toggle('locked', cur() === lockedVal);
        });
        sw.append(cb, sl, tx); cont.append(sw);
      }
      const fr = document.createElement('div'); fr.className = 'friendly';
      fr.append(datInput(buf, { off: MOD.nameTable + idx * MOD.nameStride, type: 'str', len: MOD.nameLen, label: 'Name' }, MOD));
      cont.append(fr);
      if (MOD.recipe && MOD.recipe.slots) cont.append(buildDatRecipe(buf, MOD, MOD.recordStart + idx * MOD.recordStride));
      applyMode();
    }
    if (chips[0]) chips[0].classList.add('active');
    renderSel(0);

    const ih = document.createElement('h2'); ih.textContent = '🔍 Inspektor (read-only)'; ih.className = 'expert-only'; root.append(ih);
    const insp = document.createElement('div'); insp.className = 'expert-only'; root.append(insp);
    appendInspector(insp, buf, det);
    applyMode();
  }

  function filterUI(q) {
    q = q.trim().toLowerCase();
    document.querySelectorAll('#sections details').forEach(d => {
      const hay = (d.dataset.search || '') + ' ' + Array.from(d.querySelectorAll('.kv')).map(k => k.dataset.key).join(' ');
      d.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  }

  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    fileName = f.name;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const det = BinFormat.detect(bytes);
      if (det.format === 'da2') {
        binBuf = null; binMod = null;
        model = DA2.parse(new TextDecoder('latin1').decode(bytes));
        const pay = DA2.findSection(model, 'VMCPay'); ndec = pay ? parseInt(DA2.getVal(pay, 'NDec') || '2', 10) : 2;
        const g = DA2.findSection(model, 'VMCGen'); SCH = SCHEMAS.resolve({ name: g && DA2.getVal(g, 'MN'), mc: g && DA2.getVal(g, 'MC'), format: 'da2' });
        renderEditor(); $('#save').disabled = false; status('Geladen (editierbar): ' + f.name);
      } else if (det.format === 'dat' && det.size === DAT3500.SIZE) {
        binBuf = bytes.slice(); binMod = DAT3500; SCH = SCHEMAS.resolve({ format: det.format });
        renderDatEditor(f.name, binBuf, det, DAT3500); $('#save').disabled = false;
        status('Geladen (3500-Format, editierbar): ' + f.name);
      } else if (det.format === 'dat' && det.size === DAT8192.SIZE) {
        binBuf = bytes.slice(); binMod = DAT8192; SCH = SCHEMAS.resolve({ format: det.format });
        renderDatEditor(f.name, binBuf, det, DAT8192); $('#save').disabled = false;
        status('Geladen (8192-Format, editierbar): ' + f.name);
      } else {
        binMod = null; SCH = SCHEMAS.resolve({ format: det.format });
        renderBinary(f.name, bytes, det); status('Geladen (read-only): ' + f.name + ' — ' + det.label);
      }
      if ($('#filter').value) filterUI($('#filter').value);
    } catch (err) { status('Fehler: ' + err.message); console.error(err); }
  });

  $('#save').addEventListener('click', () => {
    let blob, dl;
    if (model) { blob = new Blob([DA2.serialize(model)], { type: 'application/xml' }); dl = fileName.replace(/\.da2$/i, '') + '_edit.da2'; }
    else if (binBuf && binMod) {
      binMod.finalize(binBuf); blob = new Blob([binBuf], { type: 'application/octet-stream' }); dl = fileName.replace(/\.dat$/i, '') + '_edit.dat';
      const ck = $('#ckval'); if (ck) ck.textContent = '0x' + binBuf[binMod.CK].toString(16) + ' ✓ gespeichert';
    } else return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = dl; a.click(); URL.revokeObjectURL(a.href);
    status('Gespeichert: ' + dl);
  });

  $('#filter').addEventListener('input', e => filterUI(e.target.value));
  $('#mode').addEventListener('change', e => { expert = e.target.checked; applyMode(); });
  applyMode();

  function openLivePanel() {
    let panel = $('#livepanel');
    if (panel) { panel.style.display = 'block'; return panel; }
    panel = document.createElement('div'); panel.id = 'livepanel'; panel.className = 'livepanel';
    panel.innerHTML =
      '<div class="lp-head"><b>🔌 Live-Verbindung</b> <span id="lp-stat" class="lp-stat">verbunden</span> <button id="lp-close" title="Schließen">×</button></div>' +
      '<div class="lp-note">⚠️ Schreiben geht <b>live an die Maschine</b> (9600 8N1). Gerät muss betriebsbereit sein; Antworten werden geprüft.</div>' +
      '<div class="lp-actions"><button id="lp-boiler">Boiler-Soll lesen</button><button id="lp-price">Preis Wahl 1 lesen</button></div>' +
      '<div class="lp-cmd"><input id="lp-input" placeholder="Rohkommando, z.B. MA5*TMP*TME" autocomplete="off"><button id="lp-send">Senden</button></div>' +
      '<div class="lp-note">💳 Karten lesen/schreiben jetzt im <a href="credit.html?v=58">Guthaben-Manager</a>.</div>' +
      '<pre id="lp-log" class="lp-log"></pre>' +
      '<div class="lp-foot"><button id="lp-hide">Panel schließen</button></div>';
    document.body.append(panel);
    const log = panel.querySelector('#lp-log');
    const addlog = (pre, txt) => { log.textContent += pre + txt + '\n'; log.scrollTop = log.scrollHeight; };
    Programmer.on('line', e => addlog(e.dir === 'tx' ? '→ ' : '← ', e.text));
    Programmer.on('status', s => { const st = panel.querySelector('#lp-stat'); if (st) { st.textContent = s.connected ? 'verbunden' : 'getrennt'; st.classList.toggle('off', !s.connected); } });
    const guard = fn => async () => { try { await fn(); } catch (e) { addlog('✗ ', e.message); } };
    panel.querySelector('#lp-close').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#lp-hide').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#lp-boiler').onclick = guard(async () => { const v = await Programmer.readBoiler(); addlog('= ', 'Boiler-Soll: ' + v + ' °C'); });
    panel.querySelector('#lp-price').onclick = guard(async () => { const v = await Programmer.readPrice(1); addlog('= ', 'Preis Wahl 1: ' + v); });
    const send = guard(async () => { const inp = panel.querySelector('#lp-input'); const c = inp.value.trim(); if (!c) return; await Programmer.command(c); inp.select(); });
    panel.querySelector('#lp-send').onclick = send;
    panel.querySelector('#lp-input').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    // Maschinen-Status initial korrekt setzen
    { const st = panel.querySelector('#lp-stat'); const c = Programmer.describe().connected; st.textContent = c ? 'verbunden' : 'getrennt'; st.classList.toggle('off', !c); }
    return panel;
  }

  // Flashcard-Panel: Maschinen-Config (8192) von/auf Flashcard, nicht-blockierend mit Fortschritt.
  function openFlashPanel() {
    let panel = $('#flashpanel');
    if (panel) { panel.style.display = 'block'; return panel; }
    panel = document.createElement('div'); panel.id = 'flashpanel'; panel.className = 'livepanel';
    panel.innerHTML =
      '<div class="lp-head"><b>💳 Flashcard</b> <span id="fc-stat" class="lp-stat off">getrennt</span> <button id="fc-close" title="Schließen">×</button></div>' +
      '<div class="lp-note">Maschinen-Config (8192 B) von/auf Flashcard (AT45DB081B) über COM 115200 — läuft <b>nicht-blockierend</b> mit Fortschritt.</div>' +
      '<div class="lp-actions"><button id="fc-conn">Verbinden</button><button id="fc-read" disabled>Config lesen</button><button id="fc-write" disabled>Config schreiben</button></div>' +
      '<div class="fc-prog"><div class="fc-track"><span id="fc-fill"></span></div><span id="fc-ptext" class="fc-ptext"></span></div>' +
      '<pre id="fc-log" class="lp-log"></pre>' +
      '<div class="lp-foot"><button id="fc-hide">Schließen</button></div>';
    document.body.append(panel);
    const log = panel.querySelector('#fc-log');
    const addlog = (pre, txt) => { log.textContent += pre + txt + '\n'; log.scrollTop = log.scrollHeight; };
    const fill = panel.querySelector('#fc-fill'), ptext = panel.querySelector('#fc-ptext');
    const prog = (done, total) => { const pct = Math.round(done / total * 100); fill.style.width = pct + '%'; ptext.textContent = `Block ${done}/${total} (${pct}%)`; };
    const resetProg = () => { fill.style.width = '0%'; ptext.textContent = ''; };
    FlashCard.on('status', s => {
      const st = panel.querySelector('#fc-stat'); st.textContent = s.connected ? 'verbunden' : 'getrennt'; st.classList.toggle('off', !s.connected);
      panel.querySelector('#fc-read').disabled = !s.connected; panel.querySelector('#fc-write').disabled = !s.connected; panel.querySelector('#fc-conn').disabled = !!s.connected;
    });
    const guard = fn => async () => { try { await fn(); } catch (e) { addlog('✗ ', e.message); } };
    panel.querySelector('#fc-close').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#fc-hide').onclick = () => { panel.style.display = 'none'; };
    panel.querySelector('#fc-conn').onclick = guard(async () => { const r = await FlashCard.connect(); addlog('', '[verbunden · ID ' + (r.id || '') + ']'); });
    panel.querySelector('#fc-read').onclick = guard(async () => {
      resetProg(); addlog('', '[Lese Config von Karte …]');
      const bytes = await FlashCard.readConfig(prog);
      const det = BinFormat.detect(bytes);
      if (det.format === 'dat' && det.size === DAT8192.SIZE) {
        binBuf = bytes.slice(); binMod = DAT8192; model = null; SCH = SCHEMAS.resolve({ format: det.format });
        fileName = 'Flashcard.dat';
        renderDatEditor(fileName, binBuf, det, DAT8192); $('#save').disabled = false;
        addlog('✓ ', 'Config gelesen (8192) und in den Editor geladen.'); status('Flashcard-Config geladen (editierbar).');
      } else { addlog('✗ ', 'Unerwartetes Format von der Karte (' + det.size + ' B).'); }
    });
    panel.querySelector('#fc-write').onclick = guard(async () => {
      if (!binBuf || binMod !== DAT8192) throw new Error('Bitte erst eine 8192-Config laden/bearbeiten.');
      binMod.finalize(binBuf);
      if (!confirm('Aktuelle Config (8192 B) auf die Flashcard schreiben?\nJeder Block wird zurückgelesen und verifiziert.')) return;
      resetProg(); addlog('', '[Schreibe Config auf Karte …]');
      await FlashCard.writeConfig(binBuf, prog);
      addlog('✓ ', 'Config geschrieben & blockweise verifiziert.'); status('Flashcard-Config geschrieben ✓');
    });
    return panel;
  }

  const pb = $('#connect');
  pb.disabled = !Programmer.supported();
  pb.title = Programmer.supported() ? 'Live-Verbindung zur Maschine (WebSerial)' : 'Web Serial nur in Chrome/Edge am Desktop';
  pb.addEventListener('click', async () => {
    try { await Programmer.connect(); status('Live verbunden (9600 8N1).'); openLivePanel(); }
    catch (err) { status('Programmer: ' + err.message); }
  });

  const flb = $('#flashbtn');
  if (flb) {
    flb.disabled = !FlashCard.supported();
    flb.title = FlashCard.supported() ? 'Flashcard: Maschinen-Config lesen/schreiben' : 'Web Serial nur in Chrome/Edge/Firefox 151+ am Desktop';
    flb.addEventListener('click', () => { openFlashPanel(); });
  }


  status('Bereit. Lade eine .da2 (editierbar) oder .dat/.da3 (Inspektion).');
})();

