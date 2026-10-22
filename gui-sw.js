/* gui-sw.js — Mini-Host für die GUI-Vorschau.
 * Bedient einen virtuellen Ordner (der geladene GUI-Pack) aus dem Speicher, damit das
 * Original-GUI-JS unverändert läuft (relative Bilder, XHR auf GuiConfig.xml, Cookies …).
 * Nur Anfragen unter .../__guivfs__/ werden bedient, alles andere läuft normal weiter. */
let VFS = Object.create(null);     // "web/pagemenu.html" (lowercase) -> { blob, type }
let BYBASE = Object.create(null);  // "drink_cappuccino.png" -> erster passender VFS-Eintrag (Fallback)
const MARK = '__guivfs__/';
function rebuildIndex() {
  BYBASE = Object.create(null);
  for (const k in VFS) { const b = k.slice(k.lastIndexOf('/') + 1); if (!(b in BYBASE)) BYBASE[b] = VFS[k]; }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.cmd === 'setVFS') {
    VFS = d.files || Object.create(null);
    rebuildIndex();
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, n: Object.keys(VFS).length });
  }
});

// Mock-WebSocket vor die GUI-Scripts injizieren (für die STM32/rheaRasGui-Familie; für die
// anderen Familien harmlos, da sie kein WebSocket nutzen).
function injectMock(html) {
  const tag = '<script src="' + self.registration.scope + 'gui-rheamock.js?v=58"></script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + '\n' + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + '\n' + tag);
  return tag + '\n' + html;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const i = url.pathname.indexOf(MARK);
  if (i < 0) return;   // nicht die Vorschau → normaler Netzwerk-/Cache-Weg
  let path = decodeURIComponent(url.pathname.slice(i + MARK.length)).toLowerCase().replace(/^\/+/, '');
  const f = VFS[path] || BYBASE[path.slice(path.lastIndexOf('/') + 1)];   // Fallback: über Dateinamen
  if (!f) {
    e.respondWith(new Response('GUI-Vorschau: Datei nicht im Pack: ' + path,
      { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    return;
  }
  if (/\.html?$/i.test(path)) {
    e.respondWith(f.blob.text().then(t => new Response(injectMock(t),
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })));
    return;
  }
  e.respondWith(new Response(f.blob, {
    headers: { 'content-type': f.type, 'cache-control': 'no-store' },
  }));
});
