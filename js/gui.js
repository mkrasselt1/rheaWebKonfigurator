/* gui.js — rhea GUI-Pack laden & originalgetreu vorschauen (Schritt 1: Laden + Live-Vorschau).
 *
 * Idee: Der geladene Pack-Ordner wird als virtuelles Dateisystem an einen Service Worker
 * (gui-sw.js) geschickt, der ihn unter .../__guivfs__/ ausliefert. Dadurch läuft das
 * Original-GUI-JS unverändert — inkl. relativer Bilder, XHR auf GuiConfig.xml und der
 * Cookie-Logik (U6/SN/L …), die die Firmware sonst per URL-Parametern füttert.
 * Diese Beispiel-Cookies setzen wir hier, damit Getränkenamen/Texte erscheinen.
 */
(function () {
  const $ = s => document.querySelector(s);
  const MIME = {
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
    xml: 'text/xml; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
    svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  };
  const ext = n => n.slice(n.lastIndexOf('.') + 1).toLowerCase();
  const log = (m) => { const l = $('#gLog'); if (l) { l.textContent += m + '\n'; l.scrollTop = l.scrollHeight; } };

  // Beispiel-Laufzeitdaten (kommen auf der Maschine von der Firmware). {0} = Platzhalter für den Namen.
  const SAMPLE = {
    U6: '{0}', U7: 'Getränk wird zubereitet', U8: 'bitte warten', U9: 'Vielen Dank',
    U10: 'Bitte wählen', U11: '', U12: '', U13: '', U14: '', U15: '', U16: '',
    SN: ['Espresso', 'Caffè Crema', 'Cappuccino', 'Caffè Latte', 'Latte Macchiato', 'Milchkaffee',
      'Schokolade', 'Wiener Melange', 'Tee', 'Heißes Wasser', 'Ristretto', 'Doppio',
      'Americano', 'Flat White', 'Chococcino', 'Kakao'].join('@'),
    L: 'Inglese',
  };

  let vfs = new Map();   // "web/pagesel01.html" (lowercase) -> { blob, type, name(original) }
  let scopeURL = '';     // absolute SW-Scope, z.B. http://localhost:8777/
  let family = '';       // 'stm32' | 'pageMenu' (Touch, GuiConfig.xml) | 'pageSel' (Bild/Skin)
  let currentScreen = ''; // aktuell angezeigte Seite (für Re-Render nach Edit)
  const edited = new Set(); // relative Pfade geänderter Dateien

  function stripRoot(p) { const i = p.indexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }

  async function ensureSW() {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker nicht verfügbar — Chrome/Edge über http(s) oder localhost nötig (nicht via file://).');
    const reg = await navigator.serviceWorker.register('gui-sw.js');
    await navigator.serviceWorker.ready;
    scopeURL = reg.scope;
    if (!navigator.serviceWorker.controller) {
      await new Promise(res => { navigator.serviceWorker.addEventListener('controllerchange', res, { once: true }); setTimeout(res, 800); });
    }
    return reg;
  }

  async function pushVFS() {
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active || navigator.serviceWorker.controller;
    const files = Object.create(null);
    for (const [k, v] of vfs) files[k] = { blob: v.blob, type: v.type };
    await new Promise((res) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = e => res(e.data);
      sw.postMessage({ cmd: 'setVFS', files }, [ch.port2]);
      setTimeout(res, 3000);
    });
  }

  function setSampleCookies() {
    // wie Config.js: escape()-kodiert, path=/  → für das gesamte App-Origin (auch die iframe-Seiten) sichtbar
    for (const k in SAMPLE) document.cookie = k + '=' + escape(SAMPLE[k]) + '; path=/';
  }

  const prettify = (name) => {
    const b = name.toLowerCase();
    if (b.includes('standby')) return '💤 Standby — ' + name;
    if (b.includes('menu')) return '🍽️ Menü (Touch) — ' + name;
    if (b.includes('confirm')) return '✅ Bestätigen — ' + name;
    if (b.includes('outoforder')) return '⛔ Außer Betrieb — ' + name;
    if (b.includes('_info')) return 'ℹ️ Info — ' + name;
    if (b.includes('selend')) return '🏁 Ende — ' + name;
    if (b.includes('sel')) return '☕ Auswahl — ' + name;
    if (b.includes('config')) return '⚙️ Config — ' + name;
    return name;
  };

  function populateScreens() {
    const sel = $('#gScreen');
    sel.innerHTML = '';
    const pages = [...vfs.values()].filter(v => /\.html?$/i.test(v.name)).map(v => v.name)
      .sort((a, b) => a.localeCompare(b));
    for (const p of pages) {
      const o = document.createElement('option');
      o.value = p; o.textContent = prettify(p.replace(/^.*\//, ''));
      sel.append(o);
    }
    // sinnvoller Start
    const prefer = family === 'stm32' ? (pages.find(p => /startup\.html?$/i.test(p)) || pages.find(p => /standby/i.test(p)))
      : family === 'pageMenu' ? pages.find(p => /pagemenu\.html?$/i.test(p))
      : (pages.find(p => /standby01\.html?$/i.test(p)) || pages.find(p => /sel01\.html?$/i.test(p)));
    if (prefer) sel.value = prefer;
    return sel.value;
  }

  function showScreen(name) {
    if (!name) return;
    currentScreen = name;
    setSampleCookies();
    const url = scopeURL + '__guivfs__/' + name.split('/').map(encodeURIComponent).join('/');
    $('#gFrame').src = url + '?L=' + SAMPLE.L + '&t=' + Date.now();
    log('▶ ' + name);
  }

  /* ---------- Datei-Editor ---------- */
  const TEXT_EXT = /\.(html?|js|css|xml|json|txt|svg|rhea|rheagui|lwl)$/i;
  function populateFiles() {
    const sel = $('#gFile'); sel.innerHTML = '';
    const names = [...vfs.values()].map(v => v.name).filter(n => TEXT_EXT.test(n)).sort((a, b) => a.localeCompare(b));
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = (edited.has(n.toLowerCase()) ? '● ' : '') + n;
      sel.append(o);
    }
    $('#gEditWrap').style.display = '';
    if (names.length) { sel.value = names[0]; loadFileIntoEditor(names[0]); }
  }
  async function loadFileIntoEditor(name) {
    const v = vfs.get(name.toLowerCase()); if (!v) return;
    $('#gCode').value = await v.blob.text();
    $('#gEditNote').textContent = name + (edited.has(name.toLowerCase()) ? ' · geändert' : '');
  }
  async function applyEdit() {
    const name = $('#gFile').value; if (!name) return;
    const v = vfs.get(name.toLowerCase()); if (!v) return;
    v.blob = new Blob([$('#gCode').value], { type: v.type });
    edited.add(name.toLowerCase());
    await pushVFS();
    log('✎ übernommen: ' + name);
    const cur = $('#gFile'); const i = cur.selectedIndex; populateFiles(); cur.selectedIndex = i >= 0 ? i : 0;
    if (currentScreen) showScreen(currentScreen);
  }

  /* ---------- ZIP-Export (store, ohne Kompression) ---------- */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function exportZip() {
    const enc = new TextEncoder();
    const entries = [];
    for (const v of vfs.values()) entries.push({ name: v.name, data: new Uint8Array(await v.blob.arrayBuffer()) });
    const chunks = [], central = []; let offset = 0;
    const u16 = n => [n & 255, (n >> 8) & 255];
    const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    for (const e of entries) {
      const nameB = enc.encode(e.name), crc = crc32(e.data), sz = e.data.length;
      const lh = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nameB.length), ...u16(0)];
      chunks.push(new Uint8Array(lh), nameB, e.data);
      const lhLen = lh.length + nameB.length + sz;
      central.push({ crc, sz, nameB, offset });
      offset += lhLen;
    }
    const cd = []; let cdLen = 0;
    for (const c of central) {
      const ch = [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(c.crc), ...u32(c.sz), ...u32(c.sz), ...u16(c.nameB.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset)];
      const b = new Uint8Array(ch.length + c.nameB.length); b.set(ch, 0); b.set(c.nameB, ch.length);
      cd.push(b); cdLen += b.length;
    }
    const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdLen), ...u32(offset), ...u16(0)]);
    const blob = new Blob([...chunks, ...cd, eocd], { type: 'application/zip' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'rheaGUI-pack.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    log('⬇ ZIP exportiert (' + entries.length + ' Dateien)');
  }

  async function onFiles(fileList) {
    const files = [...fileList].filter(f => !/(^|\/)thumbs\.db$/i.test(f.webkitRelativePath || f.name));
    if (!files.length) { log('✗ keine Dateien'); return; }
    log('Lade ' + files.length + ' Dateien …');
    await ensureSW();
    vfs = new Map();
    for (const f of files) {
      let rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      rel = stripRoot(rel);                       // ausgewählten Wurzelordner-Namen entfernen
      vfs.set(rel.toLowerCase(), { blob: f, type: MIME[ext(rel)] || 'application/octet-stream', name: rel });
    }
    if ([...vfs.keys()].some(k => /(^|\/)(rhea_final\.min|rheabootstrap)\.js$/.test(k))) family = 'stm32';
    else if ([...vfs.keys()].some(k => /guiconfig\.xml$/.test(k))) family = 'pageMenu';
    else family = 'pageSel';
    await pushVFS();
    const famLabel = family === 'stm32' ? 'STM32 / rheaRasGui (WebSocket-Mock aktiv)'
      : family === 'pageMenu' ? 'Touch-GUI (GuiConfig.xml)' : 'Bild/Skin-GUI (pageSel)';
    log('✓ ' + vfs.size + ' Dateien im Vorschau-Host · Familie: ' + famLabel);
    $('#gFamily').textContent = famLabel;
    $('#gTrig').style.display = family === 'stm32' ? '' : 'none';
    $('#gBar').style.display = '';
    const first = populateScreens();
    applySize();
    showScreen(first);
    edited.clear();
    populateFiles();
  }

  function applySize() {
    const v = $('#gSize').value.split('x');
    const w = parseInt(v[0], 10) || 1024, h = parseInt(v[1], 10) || 600;
    const fr = $('#gFrame');
    fr.style.width = w + 'px'; fr.style.height = h + 'px';
    // auf Bühnenbreite herunterskalieren (nie vergrößern)
    const stage = $('#gStage');
    const avail = stage.clientWidth - 24;
    const scale = Math.min(1, avail / w);
    fr.style.transform = 'scale(' + scale + ')';
    $('#gStageInner').style.height = (h * scale + 2) + 'px';
    $('#gStageInner').style.width = (w * scale + 2) + 'px';
  }

  // ---- UI-Verdrahtung ----
  window.addEventListener('DOMContentLoaded', () => {
    $('#gPick').addEventListener('change', e => onFiles(e.target.files).catch(err => log('✗ ' + err.message)));
    $('#gScreen').addEventListener('change', e => showScreen(e.target.value));
    $('#gSize').addEventListener('change', applySize);
    $('#gReload').addEventListener('click', () => showScreen($('#gScreen').value));
    window.addEventListener('resize', () => { if ($('#gFrame').src) applySize(); });

    // State-Machine-Trigger → Event an den Mock im iframe senden
    const trig = (code, opt) => { const fr = $('#gFrame'); if (fr && fr.contentWindow) fr.contentWindow.postMessage({ __rheaTrigger: true, code, opt: opt || {} }, '*'); };
    const tp = $('#gTrig');
    if (tp) tp.addEventListener('click', (e) => {
      const t = e.target.getAttribute && e.target.getAttribute('data-trig');
      if (!t) return;
      if (t === '99') trig(99, { credit: $('#tCredit').value });
      else if (t === '100') trig(100, { text: $('#tMsg').value });
      else if (t === '97all') trig(97, { avail: Array(12).fill(1) });
      else if (t === '97none') trig(97, { avail: Array(12).fill(0) });
      else trig(parseInt(t, 10), {});
      log('🎛️ Trigger ' + t);
    });
    window.addEventListener('message', (e) => { if (e.data && e.data.__rheaMockReady) log('✓ WS-Mock bereit (' + (e.data.url || '') + ')'); });

    // Datei-Editor
    $('#gFile').addEventListener('change', e => loadFileIntoEditor(e.target.value));
    $('#gApply').addEventListener('click', () => applyEdit().catch(err => log('✗ ' + err.message)));
    $('#gExport').addEventListener('click', () => exportZip().catch(err => log('✗ ' + err.message)));
    // Drag & Drop eines Ordners
    const stage = $('#gDrop');
    if (stage) {
      ['dragover', 'drop'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); }));
      stage.addEventListener('drop', async (e) => {
        const items = [...(e.dataTransfer.items || [])];
        const out = [];
        async function walk(entry, path) {
          if (entry.isFile) { await new Promise(r => entry.file(f => { f.webkitRelativePath || Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); out.push(f); r(); })); }
          else if (entry.isDirectory) { const rd = entry.createReader(); const ents = await new Promise(r => rd.readEntries(r)); for (const c of ents) await walk(c, path + entry.name + '/'); }
        }
        for (const it of items) { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) await walk(en, ''); }
        if (out.length) onFiles(out).catch(err => log('✗ ' + err.message));
      });
    }
  });
})();
