// Unités et conversions — uniquement des conversions exactes.
// Chaque unité appartient à une « dimension ». Seules les unités d'une même
// dimension sont additionnables. Les unités culinaires approximatives
// (cuillère, pincée, botte…) forment chacune leur propre dimension : elles ne
// sont jamais converties en g ou en ml, car la conversion ne serait pas fiable.

export const UNITS = {
  g:      { dim: 'masse',  factor: 1,    label: 'g' },
  kg:     { dim: 'masse',  factor: 1000, label: 'kg' },
  ml:     { dim: 'volume', factor: 1,    label: 'ml' },
  cl:     { dim: 'volume', factor: 10,   label: 'cl' },
  l:      { dim: 'volume', factor: 1000, label: 'l' },
  piece:  { dim: 'piece',  factor: 1,    label: 'unité(s)', short: 'u.' },
  cas:    { dim: 'cas',    factor: 1,    label: 'c. à soupe' },
  cac:    { dim: 'cac',    factor: 1,    label: 'c. à café' },
  pincee: { dim: 'pincee', factor: 1,    label: 'pincée(s)' },
  botte:  { dim: 'botte',  factor: 1,    label: 'botte(s)' },
  tranche:{ dim: 'tranche',factor: 1,    label: 'tranche(s)' },
  gousse: { dim: 'gousse', factor: 1,    label: 'gousse(s)' },
};

export const UNIT_ORDER = ['g', 'kg', 'ml', 'cl', 'l', 'piece', 'cas', 'cac', 'pincee', 'botte', 'tranche', 'gousse'];

// Unité de base de chaque dimension.
export const BASE_UNIT = {
  masse: 'g', volume: 'ml', piece: 'piece', cas: 'cas', cac: 'cac',
  pincee: 'pincee', botte: 'botte', tranche: 'tranche', gousse: 'gousse',
};

// Unité « de prix » affichée (prix au kg, au litre, à l'unité).
export const PRICE_UNIT = { masse: 'kg', volume: 'l', piece: 'piece' };

const ALIASES = {
  gr: 'g', gramme: 'g', grammes: 'g', kilo: 'kg', kilos: 'kg', kilogramme: 'kg',
  millilitre: 'ml', litre: 'l', litres: 'l', lt: 'l', centilitre: 'cl',
  u: 'piece', 'u.': 'piece', unite: 'piece', unité: 'piece', unités: 'piece', unites: 'piece',
  pc: 'piece', pcs: 'piece', pièce: 'piece', pièces: 'piece', pieces: 'piece', x: 'piece',
  'c. à soupe': 'cas', cs: 'cas', 'c.à.s': 'cas', 'c. à café': 'cac', cc: 'cac', 'c.à.c': 'cac',
  pincée: 'pincee', pincées: 'pincee', bottes: 'botte', tranches: 'tranche', gousses: 'gousse',
};

export function normalizeUnit(u) {
  if (u == null) return null;
  const k = String(u).trim().toLowerCase();
  if (UNITS[k]) return k;
  if (ALIASES[k]) return ALIASES[k];
  return null;
}

export function isUnit(u) { return normalizeUnit(u) !== null; }

export function dimOf(u) {
  const n = normalizeUnit(u);
  return n ? UNITS[n].dim : null;
}

export function compatible(a, b) {
  const da = dimOf(a), db = dimOf(b);
  return da !== null && da === db;
}

// Convertit une quantité vers l'unité de base de sa dimension.
export function toBase(qty, unit) {
  const n = normalizeUnit(unit);
  if (!n) throw new Error(`Unité inconnue : ${unit}`);
  return { qty: Number(qty) * UNITS[n].factor, unit: BASE_UNIT[UNITS[n].dim], dim: UNITS[n].dim };
}

// Convertit une quantité d'une unité vers une autre, si compatible. Sinon null.
export function convert(qty, from, to) {
  const f = normalizeUnit(from), t = normalizeUnit(to);
  if (!f || !t || UNITS[f].dim !== UNITS[t].dim) return null;
  return Number(qty) * UNITS[f].factor / UNITS[t].factor;
}

// Additionne une liste de {qty, unit}. Regroupe par dimension : renvoie une
// ligne par dimension (en unité de base). Jamais de conversion inter-dimensions.
export function sumQuantities(list) {
  const byDim = new Map();
  for (const { qty, unit } of list) {
    const b = toBase(qty, unit);
    byDim.set(b.dim, (byDim.get(b.dim) || 0) + b.qty);
  }
  return [...byDim].map(([dim, qty]) => ({ dim, qty, unit: BASE_UNIT[dim] }));
}

// Arrondi doux pour l'affichage d'une quantité exprimée dans l'unité de base.
// Choisit kg / l au-delà de 1000.
export function bestDisplay(qtyBase, dim) {
  if (dim === 'masse' && Math.abs(qtyBase) >= 1000) return { qty: qtyBase / 1000, unit: 'kg' };
  if (dim === 'volume' && Math.abs(qtyBase) >= 1000) return { qty: qtyBase / 1000, unit: 'l' };
  return { qty: qtyBase, unit: BASE_UNIT[dim] };
}

export function roundQty(q) {
  if (!isFinite(q)) return q;
  if (Math.abs(q) >= 100) return Math.round(q);
  if (Math.abs(q) >= 10) return Math.round(q * 10) / 10;
  return Math.round(q * 100) / 100;
}

const nf = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 2 });

export function formatQty(qty, unit) {
  const n = normalizeUnit(unit);
  if (qty == null || qty === '' || !n) return '';
  const label = ' ' + (UNITS[n].short || UNITS[n].label);
  return nf.format(roundQty(Number(qty))) + label;
}

export function formatBase(qtyBase, dim) {
  const d = bestDisplay(qtyBase, dim);
  return formatQty(d.qty, d.unit);
}

export function unitLabel(u) {
  const n = normalizeUnit(u);
  return n ? UNITS[n].label : String(u ?? '');
}
