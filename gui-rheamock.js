/* gui-rheamock.js — Mock der Maschinen-WebSocket (ws://127.0.0.1:2280) für die STM32/rheaRasGui-GUI.
 * Wird vom Vorschau-Host VOR rhea_final.min.js injiziert und ersetzt window.WebSocket NUR für :2280.
 * Macht den Handshake, beantwortet Ajax mit Beispieldaten und pusht Events auf Anforderung
 * (requestGPUEvent) bzw. auf Knopfdruck vom Trigger-Panel (postMessage vom Eltern-Fenster).
 * Protokoll aus rhea_final.min.js: siehe Projektnotiz. onRcv erwartet onmessage({data: Blob}). */
(function () {
  if (window.__rheaMockInstalled) return;
  window.__rheaMockInstalled = true;
  const RealWS = window.WebSocket;
  const enc = new TextEncoder();                 // UTF-8
  const utf16le = (s) => { const u = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = (c >> 8) & 255; } return u; };

  const NUM = 12;                                // Beispiel-Anzahl Auswahlen
  const pricesStr = () => Array.from({ length: NUM }, (_, i) => ((120 + i * 10) / 100).toFixed(2).replace('.', ',')).join('§');
  const ajaxData = {
    selPrice: () => JSON.stringify({ n: NUM, s: pricesStr() }),
    selAvail: () => JSON.stringify({ n: NUM, s: '1'.repeat(NUM) }),
    selWithFreshMilk: () => JSON.stringify({ n: NUM, s: '0'.repeat(NUM) }),
    getSelStatus: () => JSON.stringify({ n: NUM, s: '0'.repeat(NUM) }),
    getGPUVer: () => JSON.stringify({ s: 'GUI-Mock 1.0' }),
    getCPUStrModelAndVer: () => JSON.stringify({ s: 'laRhea Grande V+ (Mock)' }),
    freshMilkRefilled: () => '{}', browserURLChange: () => '{}',
  };

  function ajaxResp(reqID, jsonStr) {            // 35 'A' 'J' reqID 'j' 'a' <UTF8-JSON>
    const body = enc.encode(jsonStr);
    const u = new Uint8Array(6 + body.length);
    u[0] = 35; u[1] = 65; u[2] = 74; u[3] = reqID & 255; u[4] = 106; u[5] = 97; u.set(body, 6);
    return u;
  }
  function eventFrame(code, payload) {           // 35 'e' 'V' 'n' code 0 0 0 <payload ab b8>
    payload = payload || new Uint8Array(0);
    const u = new Uint8Array(8 + payload.length);
    u[0] = 35; u[1] = 101; u[2] = 86; u[3] = 110; u[4] = code & 255; u.set(payload, 8);
    return u;
  }

  function MockWS(url, proto) {
    this.url = url; this.protocol = proto || ''; this.readyState = 0;
    this.onopen = this.onclose = this.onmessage = this.onerror = null;
    MockWS.last = this;
    const self = this;
    setTimeout(function () { self.readyState = 1; if (self.onopen) self.onopen({ target: self }); }, 10);
  }
  MockWS.prototype._recv = function (bytes) {
    if (this.readyState !== 1 || !this.onmessage) return;
    this.onmessage({ data: new Blob([bytes]) });
  };
  MockWS.prototype.send = function (data) {
    let b;
    if (data instanceof ArrayBuffer) b = new Uint8Array(data);
    else if (data && data.buffer) b = new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    else b = new Uint8Array(data);
    if (b[0] !== 35) return;
    const cmd = String.fromCharCode(b[1]), reqID = b[2];
    const len = (b[3] << 8) | b[4], payload = b.subarray(5, 5 + len);
    const self = this;
    if (cmd === 'I') {                            // idCode-Request → Antwort-Event 105 (idCode b10..b13)
      setTimeout(function () { self._recv(eventFrame(105, new Uint8Array([0, 0, 1, 2, 3, 4]))); }, 5);
    } else if (cmd === 'A') {                      // Ajax: [cmdLen][cmd][plenHi][plenLo][json]
      let p = 0, cl = payload[p++], cmdStr = '';
      for (let i = 0; i < cl; i++) cmdStr += String.fromCharCode(payload[p++]);
      const fn = ajaxData[cmdStr], json = fn ? fn() : '{}';
      setTimeout(function () { self._recv(ajaxResp(reqID, json)); }, 5);
    } else if (cmd === 'E') {                      // requestGPUEvent([code]) → Event pushen
      const code = payload[0];
      setTimeout(function () { self.emit(code, {}); }, 8);
    }
    // 'W','X',…: ACK/ignorieren (Auswahl-Fluss steuert das Trigger-Panel)
  };
  MockWS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose({ target: this }); };
  MockWS.prototype.addEventListener = function (t, fn) { this['on' + t] = fn; };
  MockWS.prototype.removeEventListener = function (t) { this['on' + t] = null; };
  // Event emittieren — von requestGPUEvent oder vom Trigger-Panel
  MockWS.prototype.emit = function (code, opt) {
    opt = opt || {};
    let payload = new Uint8Array(0);
    if (code === 97) {                            // AVAILABILITY: b8=count, b9..=enabled
      payload = new Uint8Array(1 + NUM); payload[0] = NUM;
      for (let i = 0; i < NUM; i++) payload[1 + i] = opt.avail ? (opt.avail[i] ? 1 : 0) : 1;
    } else if (code === 98) {                     // PRICES: utf8 ab b8
      payload = enc.encode(opt.prices || pricesStr());
    } else if (code === 99) {                     // CREDIT: utf8 ab b8
      payload = enc.encode(String(opt.credit != null ? opt.credit : '1,00'));
    } else if (code === 100) {                    // CPU_MESSAGE: b8=typ, utf16 ab b11
      const u16 = utf16le(opt.text != null ? opt.text : 'System-Meldung (Beispiel)');
      payload = new Uint8Array(3 + u16.length);
      payload[0] = opt.type != null ? opt.type : 1; payload.set(u16, 3);
    } else if (code === 72 || code === 101 || code === 102 || code === 103 || code === 104) {
      payload = new Uint8Array([opt.val != null ? opt.val : 0]); // PROGRESS/REQ_STATUS/START/STOP/STATUS
    }
    this._recv(eventFrame(code, payload));
  };

  // window.WebSocket ersetzen — nur die Maschinen-URL mocken
  const WrappedWS = function (url, proto) {
    if (typeof url === 'string' && url.indexOf('127.0.0.1:2280') >= 0) return new MockWS(url, proto);
    return new RealWS(url, proto);
  };
  WrappedWS.prototype = MockWS.prototype;
  WrappedWS.CONNECTING = 0; WrappedWS.OPEN = 1; WrappedWS.CLOSING = 2; WrappedWS.CLOSED = 3;
  window.WebSocket = WrappedWS;

  // Trigger vom Eltern-Fenster (gui.html Panel)
  window.addEventListener('message', function (e) {
    const d = e.data || {};
    if (d.__rheaTrigger && MockWS.last) MockWS.last.emit(d.code, d.opt || {});
  });
  try { parent.postMessage({ __rheaMockReady: true, url: location.href }, '*'); } catch (x) {}
})();
