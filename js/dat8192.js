/* dat8192.js — Format-Deskriptor fürs Classic „.dat" 8192 (CINO IC Pronto/Grande/eC/Doppio + Cafe Europa).
 * Checksumme identisch zum 3500 → get/set/checksum/finalize/verify aus DAT3500. Offsets aus docs/12.
 * Preise 1–4 (16-bit BE, Stride 2), Namen @0x09F4 (Stride 0x14), Record-Rezept ab 0x0002 (Stride 0x48).
 */
const DAT8192 = {
  SIZE: 8192, CK: DAT3500.CK, SUM_END: DAT3500.SUM_END,
  recordStart: 0x0002, recordStride: 0x3c,   // Record = 60 B (verifiziert über „save-Flag"-Abstand 0x3c; Record #i = Name #i)
  statusOff: 0x3a, statusLockedVal: 1,   // Auswahl-Typ @+0x3A: 0=aktiv, 1=gesperrt/inaktiv, 2=Vorwahl(Sirup/no-cup), 3=Vorwahl kalt, 4=fbt (5 Diff-Dateien)
  romNameOff: 0x39,         // ROM-Wahlnamen-Index (D04): choco creme=9, tee=14, Latte=3 (= „Selection name [N]")
  priceTables: [0x0708, 0x0C90, 0x0F8C, 0x0FC8],   // Preis 1..4
  priceLabels: ['Standard (Bar)', 'bargeldlos / Karte', 'Happy Hour / Rabatt', '4. Preis'],  // typische Nutzung; hängt von Preislisten-Konfig ab
  nameTable: 0x09F4, nameStride: 0x14, nameLen: 20,
  productTable: 0x0860, productStride: 0x1e, productLen: 30,  // Behälter: Slot 0 = Group 1, Slot 1..9 = Motor 1..9 (verifiziert, docs/16 §6b)
  containerCountOff: 0x098C,   // Anzahl routbarer Behälter-Slots (maschinenspezifisch: CINO IC=10, Cafe Europa=6)
  mixerCountOff: 0x098D,       // Anzahl Elektroventile/Mixer (1–6) — Anzeige (ändert Vorfeld 0x09E4 mit)
  // Behälter→Mixer-Routing: 1 Byte je Slot ab 0x09EA. routing[Slot i] = 0x09EA + i, i = 0..containerCount−1.
  // Wert = Ziel-Mixer 0-basiert (0=Mixer 1, 1=Mixer 2, 2=Mixer 3, 3=Mixer 4), Bereich 0..mixer−1. (docs/16 §6b, 6 Diff-Dateien)
  routingTable: 0x09EA, routingStride: 1,
  // Allgemein-Block (u16be, verifiziert via Diff some_general_settings.dat; Anker: ndec = VARIE-Index 7 @0x077A, docs/16 §2):
  //  Temperaturen @0x0758 (T1 Boiler, T2, T3, T4 Kalt/Snack); VARIE @0x076C (MachineCode A/B, Msg, Münzsystem, Fan, Beep, ndec, Sprache);
  //  Erweitert @0x0790 nach Checksumme (Bingo, Teabag 1/2, Tee-Vorbrühung + Pause). Custom-Display @0x09A0/0x09B0 (2×16 Zeichen).
  globals: [
    // Temperaturen (u16be) als Slider, 4 Thermometer im „Erweiterte Optionen"-Screen
    { key: 'boiler', off: 0x0759, type: 'u8', label: 'Temperatur 1 / Boiler', slider: true, unit: ' °C', min: 0, max: 120 },
    { key: 'temp2', off: 0x075a, type: 'u16be', label: 'Temperatur 2', slider: true, unit: ' °C', min: 0, max: 120 },
    { key: 'temp3', off: 0x075c, type: 'u16be', label: 'Temperatur 3', slider: true, unit: ' °C', min: 0, max: 120 },
    { key: 'temp4', off: 0x0760, type: 'u16be', label: 'Temperatur Kalt/Snack', slider: true, unit: ' °C', min: 0, max: 30 },
    // P-Parameter „advanced" (rheAction User Guide S.32): Pn @ 0x076C+(n-6)*2, u16be. P16@0x0780 = Checksumme.
    { key: 'mcA', off: 0x076c, type: 'u16be', label: 'P6 · Machine Code A', expert: true },
    { key: 'mcB', off: 0x076e, type: 'u16be', label: 'P7 · Machine Code B', expert: true },
    { key: 'msg', off: 0x0770, type: 'u16be', label: 'P8 · Meldungsnummer (0–7, 3=Freitext)', min: 0, max: 7 },
    { key: 'coin', off: 0x0772, type: 'u16be', label: 'P9 · Münzsystem', enum: { 0: 'Parallel einzeln', 1: 'Parallel mehrfach', 2: 'Executive', 3: 'Executive PriceHolding', 4: 'MDB' } },
    { key: 'access', off: 0x0774, type: 'u16be', label: 'P10 · Zugangscode (Passwort)', expert: true },
    { key: 'fan', off: 0x0776, type: 'u16be', label: 'P11 · Lüfterzeit', unit: 'min' },
    { key: 'beep', off: 0x0778, type: 'u16be', label: 'P12 · Beep-Zeit', unit: 's' },
    { key: 'ndec', off: 0x077B, type: 'u8', label: 'P13 · Nachkommastellen', enum: { 0: 'keine', 1: '1 Stelle', 2: '2 Stellen', 3: '3 Stellen' } },
    { key: 'lang', off: 0x077c, type: 'u16be', label: 'P14 · Sprache', enum: { 0: 'Deutsch', 1: 'Englisch' } },
    { key: 'grind', off: 0x077e, type: 'u16be', label: 'P15 · Mahlmodus', enum: { 0: 'nachher', 1: 'vorher' }, expert: true },
    { key: 'firstInstall', off: 0x0782, type: 'u16be', label: 'P17 · Erstinstallation', enum: { 0: 'erste', 1: 'keine' }, expert: true },
    { key: 'summer', off: 0x0784, type: 'u16be', label: 'P18 · Sommerzeit', enum: { 0: 'nein', 1: 'ja' }, expert: true },
    { key: 'sugar', off: 0x0786, type: 'u16be', label: 'P19 · Zucker-Standard', slider: true, min: 0, max: 5 },
    { key: 'stirrer', off: 0x0788, type: 'u16be', label: 'P20 · Rührer', enum: { 0: 'vorher', 1: 'nachher' }, expert: true },
    { key: 'stirrerNoSugar', off: 0x078a, type: 'u16be', label: 'P21 · Rührer ohne Zucker', enum: { 0: 'aus', 1: 'aktiv' }, expert: true },
    { key: 'deinstall', off: 0x078c, type: 'u16be', label: 'P22 · Deinstallation', enum: { 0: 'nein', 1: 'ja' }, expert: true },
    { key: 'brewer', off: 0x078e, type: 'u16be', label: 'P23 · Brüherposition', enum: { 0: 'zu', 1: 'offen' }, expert: true },
    { key: 'bingo', off: 0x0790, type: 'u16be', label: 'P24 · Bingo-Nummer', expert: true },
    { key: 'teabag1', off: 0x0792, type: 'u16be', label: 'P25 · Auswahl mit Teebeutel 1', expert: true },
    { key: 'teabag2', off: 0x0794, type: 'u16be', label: 'P26 · Auswahl mit Teebeutel 2', expert: true },
    { key: 'teapre', off: 0x079c, type: 'u16be', label: 'P30 · Tee-Vorbrühung', unit: 'dsec', expert: true },
    { key: 'teaprepause', off: 0x079e, type: 'u16be', label: 'P31 · Tee-Vorbrüh-Pause', unit: 'dsec', expert: true },
    // Benutzerdefinierter Display-Text (2×16 Zeichen)
    { key: 'msgline1', off: 0x09a0, type: 'str', len: 16, label: 'Zeile 1', display: true },
    { key: 'msgline2', off: 0x09b0, type: 'str', len: 16, label: 'Zeile 2', display: true },
  ],
  // Rezept je Auswahl (dekodiert aus Anwender-Diffs, docs/16 §6c):
  //  Produkt-Tripel: Behälter c @ recordBase + c*3 = [Zeit, Verzögerung, Pause]  (c = productTable-Index)
  //  Mixer-Block ab +0x1E: physischer Mixer m → Wasser @ +0x1E+(m-1)*6, Mixer @ +0x1E+(m-1)*6+3 (Mixer 4 @+0x30 verifiziert).
  //  Record 60 B: Produkte +0x00..1D (10), Mixer +0x1E..35 (bis 4), Tail +0x36..3B (u.a. ROM-Name @+0x39).
  recipe: { products: 10, ventilBase: 0x1e, ventilStride: 6, mixers: 4, slots: 20 },
  // Zeitpläne (u16be = HH*100+MM, docs/16 §6e): Happy Hour 3 Intervalle @0x0D0D, Energiespar 7 Wochentage @0x0D19.
  zeitplan: { happy: 0x0d0d, happyN: 3, energy: 0x0d19, days: 7 },
  get: (b, f) => DAT3500.get(b, f),
  set: (b, f, v) => DAT3500.set(b, f, v),
  checksum: b => DAT3500.checksum(b),
  finalize: b => DAT3500.finalize(b),
  verify: b => DAT3500.verify(b),
};
if (typeof module !== 'undefined') module.exports = DAT8192;
