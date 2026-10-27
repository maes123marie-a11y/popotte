// Stock (placard virtuel) : déduction facultative après un repas.
import { toBase, convert, normalizeUnit, BASE_UNIT } from './units.js';
import { computeNeeds } from './shopping.js';

// Calcule la déduction du stock pour une entrée de planning cuisinée.
// Renvoie { movements:[{stockId,ingredientId,dim,qtyBase}], updates:[stockItem], missing:[{ingredientId,dim,qtyBase}] }
// N'applique rien : l'appelant persiste dans une transaction.
export function deductionForEntry(entry, recipesById, stockItems) {
  const needs = computeNeeds([entry], recipesById, { includeOptional: false });
  const stock = (stockItems || []).map(s => ({ ...s }));
  const movements = [];
  const missing = [];
  for (const n of needs.values()) {
    let left = n.needBase;
    const matches = stock
      .filter(s => s.ingredientId === n.ingredientId && normalizeUnit(s.unit) && toBase(1, s.unit).dim === n.dim && s.qty > 0)
      .sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
    for (const s of matches) {
      if (left <= 1e-9) break;
      const have = toBase(s.qty, s.unit).qty;
      const take = Math.min(have, left);
      s.qty = convert(have - take, BASE_UNIT[n.dim], s.unit);
      if (Math.abs(s.qty) < 1e-9) s.qty = 0;
      left -= take;
      movements.push({ stockId: s.id, ingredientId: n.ingredientId, dim: n.dim, qtyBase: take });
    }
    if (left > 1e-9) missing.push({ ingredientId: n.ingredientId, dim: n.dim, qtyBase: left });
  }
  const touched = new Set(movements.map(m => m.stockId));
  return { movements, updates: stock.filter(s => touched.has(s.id)), missing };
}

// Annule des mouvements : rend les quantités au stock.
export function undoMovements(movements, stockItems) {
  const byId = new Map((stockItems || []).map(s => [s.id, { ...s }]));
  const updates = new Map();
  for (const m of movements || []) {
    const s = byId.get(m.stockId);
    if (!s) continue; // l'article de stock a été supprimé entre-temps
    const add = convert(m.qtyBase, BASE_UNIT[m.dim], s.unit);
    if (add == null) continue;
    s.qty = Number(s.qty) + add;
    updates.set(s.id, s);
  }
  return [...updates.values()];
}

export function expiryState(s, now = new Date()) {
  if (!s.expiry) return null;
  const d = new Date(s.expiry + 'T23:59:59');
  const days = Math.floor((d - now) / 86400000);
  if (days < 0) return 'perime';
  if (days <= 3) return 'bientot';
  return 'ok';
}
