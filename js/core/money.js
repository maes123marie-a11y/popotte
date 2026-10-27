// Montants : calculs en nombres flottants double précision, arrondi
// uniquement à l'affichage (ou via round2 pour les comparaisons).

export function round2(x) {
  if (x == null || !isFinite(x)) return x;
  return Math.round((x + Math.sign(x) * Number.EPSILON) * 100) / 100;
}

const eur = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEUR(x) {
  if (x == null || !isFinite(x)) return '—';
  return eur.format(round2(x));
}

// Analyse une saisie utilisateur « 2,49 » / « 2.49 » / « 2,49 € ». Vide → null.
export function parseAmount(v) {
  if (v == null) return null;
  const s = String(v).replace(/€/g, '').replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : NaN;
}

export function parseQty(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  // Fractions simples « 1/2 »
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? n : NaN;
}
