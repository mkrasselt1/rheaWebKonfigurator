/* credit.js — Guthaben-Manager: Hardware-Auswahl (rhea-Leser / PN532), Karte lesen,
 * bekannte Karten + Buchungen dauerhaft im Browser (localStorage) + JSON-Export/Import. */
(function () {
  const $ = s => document.querySelector(s);
  const drivers = { rhea: CardProgrammer, pn532: PN532 };
  // Treiber IMMER aus dem aktuellen Dropdown-Wert ableiten — sonst merkt Chrome nach Reload
  // die Auswahl „PN532", aber drv steht noch auf dem Standard (rhea) → falsches Protokoll.
  const pickDrv = () => drivers[($('#hw') && $('#hw').value) || 'rhea'] || drivers.rhea;
  let drv = pickDrv();

  /* ---------- Speicher ---------- */
  const KEY = 'rheaCreditStore_v1';
  let store = { cards: {}, activity: [] };
  function load() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.cards) store = s; } catch (e) {} }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { addlog('✗ ', 'Speichern fehlgeschlagen: ' + e.message); } }
  load();

  const log = $('#log');
  const addlog = (pre, txt) => { log.textContent += pre + txt + '\n'; log.scrollTop = log.scrollHeight; };
  const fmt = ts => new Date(ts).toLocaleString('de-DE');
  const eurFmt = cents => (cents / 100).toFixed(2).replace('.', ',') + ' €';   // Cent -> „12,34 €"

  const setStat = (connected) => {
    const s = $('#stat'); s.textContent = (connected ? 'verbunden' : 'getrennt') + (connected ? ' · ' + ($('#hw').value === 'pn532' ? 'PN532 115200' : 'rhea 115200') : '');
    s.classList.toggle('on', connected);
    $('#connect').disabled = connected; $('#disconnect').disabled = !connected; $('#read').disabled = !connected;
    const canWrite = connected && typeof drv.writeBlock === 'function';
    ['#w-type', '#w-credit', '#w-codeb', '#w-value', '#write-card'].forEach(s => { const el = $(s); if (el) el.disabled = !canWrite; });
  };

  function wire(d) {
    d.on('log', e => addlog(e.dir === 'tx' ? '→ ' : '← ', e.hex));
    d.on('status', s => setStat(s.connected));
  }
  Object.values(drivers).forEach(wire);
  $('#hw').addEventListener('change', e => { drv = drivers[e.target.value]; });

  const guard = fn => async () => { try { await fn(); } catch (e) { addlog('✗ ', e.message); setStat(false); } };

  $('#connect').onclick = guard(async () => {
    drv = pickDrv();   // sicherstellen, dass der Treiber zum Dropdown passt (auch nach Reload)
    if (!drv.supported()) throw new Error('Web Serial nur in Chrome/Edge am Desktop.');
    if ($('#hw').value === 'pn532') addlog('', '[PN532 (HSU 115200) — servosecure SRI512 lesen & schreiben]');
    await drv.connect();
  });
  $('#disconnect').onclick = guard(async () => { await drv.disconnect(); addlog('', '[getrennt]'); });

  /* ---------- Kartentyp (aus Block 07 d0 + Block 08 Funktionscode, docs/02) ---------- */
  function cardType(c) {
    const b = c.blocks || {};
    const b07 = b[0x07], b08 = b[0x08];
    if (!b07) return '—';
    const t = b07[0];                         // 01=Standard, 02=Spezial, 03=Aufwertung, 04=Door
    if (t === 0x01) return 'Standard (Guthaben)';
    if (t === 0x03) return 'Aufwertung (Recharge)';
    if (t === 0x04) return 'Door Unlock';
    if (t === 0x02) {
      const fn = b08 ? b08[2] : null;         // Funktionscode in Block 08 Byte 2
      switch (fn) {
        case 0x03: return `Water Purifier (Wert ${b07[2]})`;
        case 0x07: return 'Double Selection';
        case 0x08: return 'Kannenkarte';
        case 0x09: return 'Free Vending';
        case 0x00: return 'Door Unlock';
        default: return `Spezial (Fn ${fn != null ? '0x' + fn.toString(16).toUpperCase().padStart(2, '0') : '?'})`;
      }
    }
    return `unbekannt (Typ 0x${t.toString(16).toUpperCase().padStart(2, '0')})`;
  }
  // Guthaben-Karten (Standard 0x01 + Aufwertung 0x03) — beide tragen Credit in Blk 08/09
  function isStandard(c) { const b = c.blocks || {}; const t = b[0x07] && b[0x07][0]; return t === 0x01 || t === 0x03; }
  // erkannten Typ auf einen Select-Schlüssel abbilden
  function detectTypeKey(c) {
    const b = c.blocks || {}, b07 = b[0x07], b08 = b[0x08];
    if (!b07) return null;
    const t = b07[0];
    if (t === 0x01) return 'standard';
    if (t === 0x03) return 'recharge';
    if (t === 0x04) return 'door';
    if (t === 0x02) return { 0x03: 'water', 0x07: 'double', 0x08: 'kanne', 0x09: 'free' }[b08 ? b08[2] : -1] || null;
    return null;
  }

  /* ---------- Anzeige aktuelle Karte ---------- */
  function showCard(c) {
    $('#k-uid').textContent = c.uidText || '—';
    $('#k-credit').textContent = (c.credit != null && isStandard(c)) ? eurFmt(c.credit) : '—';
    $('#k-codeb').textContent = c.codeB != null ? c.codeB : '—';
    $('#k-ctr').textContent = c.counter != null ? c.counter : '—';
    $('#k-type').textContent = cardType(c);
    // Schreib-Felder nach erkanntem Typ vorbelegen
    const key = detectTypeKey(c);
    if (key) { $('#w-type').value = key; updateTypeFields(); }
    if (c.credit != null && isStandard(c)) $('#w-credit').value = (c.credit / 100).toFixed(2);
    if (c.codeB != null) $('#w-codeb').value = c.codeB;
    if (key === 'water' && c.blocks && c.blocks[0x07]) $('#w-value').value = c.blocks[0x07][2];
    const tb = $('#blocks'); tb.innerHTML = '';
    for (let b = 0; b <= 0x0f; b++) {
      const hx = c.blockHex[b];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${b.toString(16).padStart(2, '0').toUpperCase()}</td><td>${hx ? hx.toUpperCase() : '—'}</td>`;
      tb.append(tr);
    }
  }

  /* ---------- Store-Updates ---------- */
  function recordRead(c) {
    const now = Date.now();
    const uid = c.uidText || '(unbekannt)';
    const type = cardType(c);
    const cr = isStandard(c) ? c.credit : null;   // € nur bei Guthabenkarten sinnvoll
    let card = store.cards[uid];
    if (!card) card = store.cards[uid] = { uid, name: '', type, firstSeen: now, reads: 0, writes: 0 };
    card.type = type; card.lastCredit = cr; card.lastCodeB = c.codeB; card.counter = c.counter;
    card.lastSeen = now; card.reads = (card.reads || 0) + 1;
    store.activity.unshift({ ts: now, uid, action: 'gelesen', type, credit: cr, codeB: c.codeB });
    if (store.activity.length > 2000) store.activity.length = 2000;
    save(); renderCards(); renderBook();
  }

  /* ---------- Render bekannte Karten ---------- */
  function renderCards() {
    const tb = $('#cards'); tb.innerHTML = '';
    const list = Object.values(store.cards).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    $('#cards-count').textContent = list.length ? `(${list.length})` : '';
    for (const card of list) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><input class="name" value="${(card.name || '').replace(/"/g, '&quot;')}" placeholder="Name…" data-uid="${card.uid}"></td>` +
        `<td class="uid">${card.uid}</td>` +
        `<td>${card.type || '—'}</td>` +
        `<td>${card.lastCredit != null ? eurFmt(card.lastCredit) : '—'}</td>` +
        `<td>${card.lastCodeB != null ? card.lastCodeB : '—'}</td>` +
        `<td>${(card.reads || 0)}/${(card.writes || 0)}</td>` +
        `<td>${card.lastSeen ? fmt(card.lastSeen) : '—'}</td>` +
        `<td><button class="del" data-uid="${card.uid}" title="Karte vergessen">🗑</button></td>`;
      tb.append(tr);
    }
    tb.querySelectorAll('input.name').forEach(inp => inp.addEventListener('change', () => {
      const u = inp.dataset.uid; if (store.cards[u]) { store.cards[u].name = inp.value; save(); }
    }));
    tb.querySelectorAll('button.del').forEach(btn => btn.addEventListener('click', () => {
      const u = btn.dataset.uid;
      if (confirm('Karte „' + (store.cards[u] && store.cards[u].name || u) + '" aus der Liste entfernen?')) { delete store.cards[u]; save(); renderCards(); }
    }));
  }

  /* ---------- Render Buchungen ---------- */
  function renderBook() {
    const tb = $('#book'); tb.innerHTML = '';
    for (const a of store.activity.slice(0, 200)) {
      const tr = document.createElement('tr');
      const name = store.cards[a.uid] && store.cards[a.uid].name;
      tr.innerHTML = `<td>${fmt(a.ts)}</td><td>${a.action}</td><td>${a.type || '—'}</td><td>${name ? name + ' · ' : ''}${a.uid}</td><td>${a.credit != null ? eurFmt(a.credit) : '—'}</td><td>${a.codeB != null ? a.codeB : '—'}</td>`;
      tb.append(tr);
    }
  }

  /* ---------- Lesen ---------- */
  $('#read').onclick = guard(async () => {
    $('#read').disabled = true;
    try {
      const c = await drv.readCard();
      showCard(c);
      recordRead(c);
      addlog('= ', `Karte [${cardType(c)}]: UID ${c.uidText || '?'}, Credit ${c.credit}, Code B ${c.codeB}, Zähler ${c.counter}`);
    } finally { $('#read').disabled = false; }
  });

  /* ---------- Schreiben: Blöcke je Kartentyp bauen (verifizierte Formeln, docs/02) ---------- */
  const SP_FN = { water: 0x03, kanne: 0x08, free: 0x09, double: 0x07 };  // Funktionscode (Block08 Byte2)
  function buildBlocks(type, p, nz) {
    if (type === 'standard' || type === 'recharge') {
      const crLo = p.credit & 0xff, crHi = (p.credit >> 8) & 0xff;   // Credit = 2 Byte LE (Cent)
      const cbLo = p.codeB & 0xff, cbHi = (p.codeB >> 8) & 0xff;
      const t0 = type === 'recharge' ? 0x03 : 0x01;                  // Standard=0x01, Aufwertung=0x03 (an echter 20€-Karte verifiziert)
      return {
        0x05: [nz, 0xff, 0xff, 0xff],
        0x07: [t0, (nz + 2 * crLo + cbLo + 0x5a + t0) & 0xff, 0x00, 0x00],   // d1 bindet das Typ-Byte ein (+0x5B Std / +0x5D Aufw.)
        0x08: [crLo, crHi, 0x20, (0x01 - nz - crLo - crHi) & 0xff],
        0x09: [crLo, crHi, 0x30, (0xf1 - nz - crLo - crHi) & 0xff],
        0x0a: [0x00, 0x00, cbLo, cbHi],
      };
    }
    // Spezialkarten: Code B in Block 0A Byte0–1; d1 enthält (wie bei Standard) CodeB_low.
    const cbLo = p.codeB & 0xff, cbHi = (p.codeB >> 8) & 0xff;
    if (type === 'door') {
      return { 0x05: [nz, 0xff, 0xff, 0xff], 0x07: [0x04, (nz + cbLo + 0x0e) & 0xff, 0x00, 0x00],
        0x08: [0, 0, 0, 0], 0x09: [0, 0, 0, 0], 0x0a: [cbLo, cbHi, 0x00, 0x00] };
    }
    const fn = SP_FN[type], value = type === 'water' ? (p.value & 0xff) : 0;
    return {
      0x05: [nz, 0xff, 0xff, 0xff],
      0x07: [0x02, (nz + fn + value + cbLo + 0x0c) & 0xff, value, 0x00],
      0x08: type === 'water' ? [0x00, (0xff - value) & 0xff, 0x03, 0x00] : [0x00, 0x00, fn, 0x00],
      0x09: [0, 0, 0, 0],
      0x0a: [cbLo, cbHi, 0x00, 0x00],
    };
  }
  const typeLabel = () => $('#w-type').selectedOptions[0].textContent;
  function describeWrite(type, p) {
    if (type === 'standard' || type === 'recharge') return `Guthaben ${eurFmt(p.credit)}, Code B ${p.codeB}`;
    if (type === 'water') return `Wert ${p.value}, Code B ${p.codeB}`;
    return `Code B ${p.codeB}`;
  }

  async function writeCard(type, p) {
    if (typeof drv.writeBlock !== 'function') throw new Error('Dieser Treiber kann (noch) nicht schreiben.');
    const before = await drv.readCard();
    if (before.counter == null) throw new Error('Keine lesbare Karte.');
    const nz = (before.counter - 1) & 0xff;
    const desc = describeWrite(type, p), lbl = typeLabel();
    if (!confirm(`Karte ${before.uidText} als „${lbl}" schreiben?\n${desc ? desc + '\n' : ''}Schreibzähler ${before.counter}→${nz}. Nicht umkehrbar.`)) return;
    const blocks = buildBlocks(type, p, nz);
    addlog('', `[Schreibe ${lbl}${desc ? ' (' + desc + ')' : ''}, Zähler ${before.counter}→${nz} …]`);
    for (const b of [0x05, 0x07, 0x08, 0x09, 0x0a]) {
      const ok = await drv.writeBlock(b, blocks[b]);
      if (!ok) throw new Error(`Block ${b.toString(16).toUpperCase()} schreiben fehlgeschlagen.`);
    }
    const after = await drv.readCard();
    showCard(after);
    const now = Date.now();
    const acr = isStandard(after) ? after.credit : null;
    store.activity.unshift({ ts: now, uid: after.uidText || before.uidText, action: 'geschrieben', type: cardType(after), credit: acr, codeB: after.codeB });
    const card = store.cards[after.uidText]; if (card) { card.writes = (card.writes || 0) + 1; card.lastCredit = acr; card.lastCodeB = after.codeB; card.counter = after.counter; card.type = cardType(after); card.lastSeen = now; }
    save(); renderCards(); renderBook();
    const okStd = (type === 'standard' || type === 'recharge') ? (after.credit === (p.credit & 0xff) && after.codeB === (p.codeB & 0xffff)) : true;
    addlog(okStd ? '✓ ' : '✗ ', `Ergebnis: ${cardType(after)}, Credit ${after.credit}, Code B ${after.codeB}, Zähler ${after.counter}.`);
  }

  function updateTypeFields() {
    const type = $('#w-type').value;
    const show = { credit: ['standard', 'recharge'], codeb: ['standard', 'recharge', 'water', 'kanne', 'free', 'double', 'door'], value: ['water'] };
    for (const f of ['credit', 'codeb', 'value']) {
      document.querySelectorAll(`.cm-row[data-f="${f}"]`).forEach(row => { row.hidden = !show[f].includes(type); });
    }
  }
  $('#w-type').addEventListener('change', updateTypeFields);

  // €-Schnellbuttons: addieren € auf das Guthaben-Feld (0 = leeren)
  document.querySelectorAll('.qa').forEach(btn => btn.addEventListener('click', () => {
    const e = parseFloat(btn.dataset.eur);
    const inp = $('#w-credit');
    inp.value = e === 0 ? '' : Math.min(655.35, (parseFloat(inp.value) || 0) + e).toFixed(2);
  }));

  $('#write-card').onclick = guard(async () => {
    const type = $('#w-type').value, p = {};
    const cb = parseInt($('#w-codeb').value, 10); p.codeB = isNaN(cb) ? 0 : cb;   // Machine Code B (alle Typen)
    if (type === 'standard' || type === 'recharge') {
      p.credit = Math.round((parseFloat($('#w-credit').value) || NaN) * 100);   // € -> Cent
      if (!(p.credit >= 0)) throw new Error('Bitte gültiges Guthaben (€) eingeben.');
      if (p.credit > 65535) throw new Error('Maximal 655,35 €.');
    } else if (type === 'water') {
      p.value = parseInt($('#w-value').value, 10);
      if (!(p.value >= 0 && p.value <= 255)) throw new Error('Wert 0–255 eingeben.');
    }
    $('#write-card').disabled = true;
    try { await writeCard(type, p); } finally { $('#write-card').disabled = false; }
  });

  /* ---------- Export / Import ---------- */
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rhea-guthaben-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#import').onclick = () => $('#importfile').click();
  $('#importfile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.cards) throw new Error('Keine gültige Sicherung.');
        // Merge: Karten zusammenführen (Namen behalten), Buchungen anfügen + dedupe
        for (const [uid, card] of Object.entries(data.cards)) {
          const cur = store.cards[uid];
          store.cards[uid] = cur ? { ...card, ...cur, name: cur.name || card.name,
            reads: Math.max(cur.reads || 0, card.reads || 0), writes: Math.max(cur.writes || 0, card.writes || 0) } : card;
        }
        const seen = new Set(store.activity.map(a => a.ts + '|' + a.uid + '|' + a.action));
        for (const a of (data.activity || [])) { const k = a.ts + '|' + a.uid + '|' + a.action; if (!seen.has(k)) store.activity.push(a); }
        store.activity.sort((a, b) => b.ts - a.ts);
        save(); renderCards(); renderBook();
        addlog('', `[Import: ${Object.keys(data.cards).length} Karten, ${(data.activity || []).length} Buchungen zusammengeführt]`);
      } catch (err) { addlog('✗ ', 'Import fehlgeschlagen: ' + err.message); }
      e.target.value = '';
    };
    r.readAsText(f);
  });

  /* ---------- Start ---------- */
  updateTypeFields();
  setStat(false);
  renderCards(); renderBook();
  addlog('', '[Bereit. Hardware wählen und „Verbinden".]');
})();
