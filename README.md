# rheaWebKonfigurator

Browser-Werkzeug zum **Konfigurieren** von rheavendors- / rheAction-Kaffeeautomaten
(Servomat Steigler, LUCE zero) und zum **Lesen & Beschreiben** der servosecure-Guthabenkarten —
damit sich die Maschinen weiter warten lassen, auch ohne das Original-Werkzeug des Herstellers.

Reines Vanilla-JavaScript, **keine Installation, keine Build-Tools, kein Server-Backend**.
Alles läuft im Browser.

## ▶️ Direkt benutzen

**Online (GitHub Pages):** einfach die Projektseite öffnen und loslegen.

**Lokal:** dieses Repo als ZIP herunterladen (grüner Button *Code → Download ZIP*), entpacken und
`index.html` in **Chrome oder Edge** öffnen. Oder die Standalone-Einzeldatei
`credit-standalone.html` herunterladen und doppelklicken.

## Was es kann

- **Konfig-Editor** (`index.html`): `.da2` (XML) und `.dat` (3500/8192) laden, bearbeiten
  (Getränke, Preise, Temperaturen, Rezept-Zeitachse, Behälter-Zuordnung …) und mit automatisch
  neu berechneter Prüfsumme speichern.
- **Guthaben-Manager** (`credit.html`): servosecure-Karten (ST SRI512) auslesen und beschreiben —
  Guthaben, Code B, Karten-Typ (Standard / Aufwertung / Spezialkarten), Buchungs-Log.

## Hardware & Browser

- **Browser:** Chrome oder Edge am **Desktop** (für die Kartenfunktion; der reine Editor läuft überall).
  Die Kartenfunktion nutzt die **Web Serial API** und braucht einen *secure context* —
  erfüllt durch **HTTPS** (GitHub Pages) oder **localhost** oder **`file://`**.
- **Kartenleser:** der originale rhea-Leser (FTDI USB-UART) **oder** ein **PN532 USB-C**
  (Elechouse NFC-Modul, HSU/UART, 115200 8N1). Die servosecure-Karten sind ST SRI512 (ISO 14443-B′) und *nicht*
  mit Handy-NFC lesbar — es braucht einen dieser Leser.

## ⚠️ Hinweise

- **Unabhängiges Community-Projekt**, nicht vom Hersteller rheavendors / Servomat Steigler
  autorisiert oder unterstützt. Marken- und Produktnamen gehören ihren jeweiligen Eigentümern.
- **Nutzung auf eigene Gefahr.** Das Schreiben falscher Werte in eine Maschine kann die Hardware
  fehlkonfigurieren oder beschädigen. Immer zuerst **lesen / sichern**, nur eigene Geräte, und
  Änderungen verstehen, bevor du schreibst.
- Der Schreibzähler der SRIX-Karten ist hardwareseitig **nur herunterzählbar**; jeder
  Schreibvorgang verbraucht einen Tick.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
