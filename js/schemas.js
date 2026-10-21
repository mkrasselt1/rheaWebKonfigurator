/* schemas.js — Parameter-Schemas pro Plattform/Modell (Basis für modell-spezifische Oberfläche).
 * Liefert Labels, Enums und Wertebereiche. Byte-Offsets der Binärformate sind NICHT hier —
 * die werden pro Modell separat dekodiert (docs/06). Quelle: Handbücher + rheAction-UI (docs/07–09).
 */
const SCHEMAS = (function () {
  const PLATFORMS = {
    rhea: {
      label: 'rhea-Plattform (da2/da3)',
      payType: { 0: 'Parallel einzeln', 1: 'Parallel mehrfach', 2: 'Executive', 3: 'Executive PriceHolding', 4: 'MDB', 5: 'Rhea parallel einzeln', 6: 'Rhea parallel mehrfach', 7: 'Rhea card + parallel', 8: 'Rhea card + Rhea parallel' },
      fields: {
        MN: { label: 'Maschinenname' }, MC: { label: 'Machine Code' }, NP: { label: 'Zahl der Produkte' }, NS: { label: 'Zahl der Auswahlen' },
        TE: { label: 'Temp Espresso/Boiler (°C)', min: 0, max: 95 }, TS: { label: 'Temp Instant/Druckboiler (°C)', min: 0, max: 110 },
        TR: { label: 'Temp Brühkammer (°C)', min: 0, max: 40 }, TC: { label: 'Temp Kalt (°C)', min: 0, max: 15 },
        NDec: { label: 'Nachkommastellen', min: 0, max: 3 }, SD: { label: 'Zucker-Standard', enum: { 0: 'kein Zucker', 3: 'mittel', 6: 'maximum' } },
        FT: { label: 'Verzögerung Lüfter' }, FK: { label: 'Freevend-Key HW' }, BA: { label: 'Banknoten-Annahme' },
        X: { label: 'Gerät/Produktbehälter' }, D: { label: 'Verzögerung' }, T: { label: 'Dauer [dsec]' },
        V: { label: 'Geschw. 6/8/15 / Mahlzeit' }, Y: { label: 'Produktvariation (%)' }, Z: { label: 'Brüherdruck (0–10 mm)' },
        AD: { label: 'Vorlauf AD [dsec]' }, DN: { label: 'Anzeigename' }, FN: { label: 'Beschreibung (intern)' },
      },
    },
    classic: {
      label: 'Classic (.dat, HCS12)',
      payType: { 0: 'Parallel einzeln', 1: 'Parallel mehrfach', 2: 'Executive', 3: 'Executive PriceHolding', 4: 'MDB' },
      fields: {
        P6: { label: 'Machine Code A' }, P7: { label: 'Machine Code B' }, P8: { label: 'Meldungsnummer' },
        P9: { label: 'Münzsystem', min: 0, max: 4 }, P10: { label: 'Passwort' }, P11: { label: 'Lüfterzeit [min]' },
        P12: { label: 'Beep [s]' }, P13: { label: 'Nachkommastellen', min: 0, max: 3 }, P14: { label: 'Sprache' },
        P15: { label: 'Mahlwerk', enum: { 0: 'nachher', 1: 'vorher' } }, P16: { label: 'interne Checksumme', readonly: true },
        P17: { label: 'Erstinstallation', enum: { 0: 'erste', 1: 'keine' } }, P19: { label: 'Zucker-Default' }, P23: { label: 'Brüherposition', enum: { 0: 'zu', 1: 'offen' } },
      },
    },
  };

  // Modell-Erkennung über Maschinenname (enthält) oder Machine Code; mit Overrides.
  const MODELS = {
    'luce zero': { platform: 'rhea', mc: 58, payTypeMax: 8, features: ['Touch optional', 'Becher-/Personensensor', 'Mahltyp 0–7'] },
    'luce x2': { platform: 'rhea', mc: 53, payTypeMax: 8 },
    'larhea grande': { platform: 'rhea', payTypeMax: 4, maxSel: 48, menu: 'Tasten', features: ['Vorwahl-Matrix 12×4', 'LM-Ausgabe', 'Kanne'] },
    'larhea': { platform: 'rhea', payTypeMax: 4, menu: 'Tasten' },
    'cafe europa': { platform: 'classic', payTypeMax: 4, variants: ['PB=CEED', 'SM=CEHD'] },
    'europa': { platform: 'classic', payTypeMax: 4 },
    'xs grande': { platform: 'classic', payTypeMax: 4 },
    'grande': { platform: 'classic', payTypeMax: 4 },
    'cino ic': { platform: 'classic', payTypeMax: 4 },
    'cino xs': { platform: 'classic', payTypeMax: 4, format: 'dat3500' },
    'cino xm': { platform: 'classic', payTypeMax: 4, format: 'dat3500' },
  };

  function resolve(opts) {
    opts = opts || {};
    const n = (opts.name || '').toLowerCase();
    let modelKey = Object.keys(MODELS).find(k => n.includes(k));
    if (!modelKey && opts.mc != null) modelKey = Object.keys(MODELS).find(k => MODELS[k].mc != null && MODELS[k].mc === Number(opts.mc));
    const model = modelKey ? MODELS[modelKey] : null;
    const fmt = opts.format || '';
    const platformKey = model ? model.platform : (fmt === 'da2' || fmt === 'da3' ? 'rhea' : (fmt.indexOf('dat') === 0 ? 'classic' : 'rhea'));
    const platform = PLATFORMS[platformKey];
    let payType = platform.payType;
    if (model && model.payTypeMax != null) { payType = {}; for (const k in platform.payType) if (Number(k) <= model.payTypeMax) payType[k] = platform.payType[k]; }
    return { platformKey, platform, model: model || {}, modelKey: modelKey || null, payType, fields: platform.fields };
  }

  return { PLATFORMS, MODELS, resolve };
})();
if (typeof module !== 'undefined') module.exports = SCHEMAS;
