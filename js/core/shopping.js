// Génération de la liste de courses et synchronisation avec la liste réelle.
import { toBase, normalizeUnit } from './units.js';
import { purchaseFor, priceSourceFor } from './costing.js';

export const CATEGORIES = [
  'Fruits et légumes', 'Viande et poisson', 'Produits laitiers', 'Épicerie sèche',
  'Conserves', 'Surgelés', 'Boulangerie', 'Boissons', 'Entretien et hygiène', 'Autres',
];

export const RECIPE_CATEGORIES = ['Végétarien', 'Viande', 'Poisson', 'Pâtes', 'Salade', 'Soupe', 'Dessert', 'Autre'];

const EPS = 1e-6;

const get = (m, k) => (m && m.get ? m.get(k) : m ? m[k] : undefined);

export const needKey = (ingredientId, dim) => `${ingredientId}|${dim}`;

// Besoins bruts d'une semaine : un besoin par (ingrédient, dimension).
export function computeNeeds(entries, recipesById, { includeOptional = true } = {}) {
  const needs = new Map();
  for (const e of entries || []) {
    const r = get(recipesById, e.recipeId);
    if (!r) continue;
    const ref = r.servings > 0 ? r.servings : 1;
    const factor = (e.servings > 0 ? e.servings : ref) / ref;
    for (const it of r.items || []) {
      if (!it.ingredientId || !normalizeUnit(it.unit) || !(Number(it.qty) > 0)) continue;
      if (it.optional && !includeOptional) continue;
      const b = toBase(Number(it.qty) * factor, it.unit);
      const key = needKey(it.ingredientId, b.dim);
      let n = needs.get(key);
      if (!n) {
        n = { key, ingredientId: it.ingredientId, dim: b.dim, needBase: 0, optionalOnly: true, recipeIds: [] };
        needs.set(key, n);
      }
      n.needBase += b.qty;
      if (!it.optional) n.optionalOnly = false;
      if (!n.recipeIds.includes(r.id)) n.recipeIds.push(r.id);
    }
  }
  return needs;
}

// Quantités en stock disponibles par clé (ingrédient|dimension).
// `addBack` : mouvements de déduction de CETTE semaine, réintégrés pour que les
// repas déjà cuisinés n'augmentent pas les besoins de leur propre semaine.
export function stockByKey(stockItems, addBack = []) {
  const m = new Map();
  for (const s of stockItems || []) {
    if (!s.ingredientId || !normalizeUnit(s.unit) || !(Number(s.qty) > 0)) continue;
    const b = toBase(Number(s.qty), s.unit);
    const k = needKey(s.ingredientId, b.dim);
    m.set(k, (m.get(k) || 0) + b.qty);
  }
  for (const mv of addBack || []) {
    const k = needKey(mv.ingredientId, mv.dim);
    m.set(k, (m.get(k) || 0) + mv.qtyBase);
  }
  return m;
}

export function applyStock(needs, stockMap, enabled = true) {
  for (const n of needs.values()) {
    const avail = enabled ? (stockMap.get(n.key) || 0) : 0;
    n.stockBase = Math.min(avail, n.needBase);
    n.toBuyBase = Math.max(0, n.needBase - n.stockBase);
  }
  return needs;
}

// Synchronise la liste existante d'une semaine avec les besoins calculés.
// Règles :
//  - les articles manuels ne sont jamais touchés ;
//  - l'état coché, la note, la quantité ajustée et la catégorie déplacée sont conservés ;
//  - un article auto devenu inutile est supprimé seulement s'il n'a jamais été
//    touché ; sinon il est marqué « orphelin » et l'utilisateur décide ;
//  - un article supprimé manuellement reste supprimé (pierre tombale) tant que
//    le besoin existe.
export function reconcile(existing, needs, { weekId, ingredientsById, now = new Date().toISOString(), newId }) {
  const stats = { added: 0, updated: 0, orphaned: 0, deleted: 0 };
  const out = [];
  const byKey = new Map();
  for (const it of existing || []) {
    if (it.origin === 'auto') byKey.set(it.key, it);
    else out.push(it);
  }
  for (const n of needs.values()) {
    const ing = get(ingredientsById, n.ingredientId);
    const cur = byKey.get(n.key);
    if (cur) {
      byKey.delete(n.key);
      const next = { ...cur };
      const changed = Math.abs((cur.toBuyBase || 0) - n.toBuyBase) > EPS ||
        Math.abs((cur.needBase || 0) - n.needBase) > EPS;
      if (cur.checked && Math.abs((cur.toBuyBase || 0) - n.toBuyBase) > EPS) {
        next.changedAfterCheck = { fromBase: cur.changedAfterCheck ? cur.changedAfterCheck.fromBase : cur.toBuyBase };
      }
      next.needBase = n.needBase; next.stockBase = n.stockBase; next.toBuyBase = n.toBuyBase;
      next.optional = n.optionalOnly; next.recipeIds = n.recipeIds;
      if (ing) {
        next.name = ing.name;
        if (!cur.categoryOverridden) next.category = ing.category || 'Autres';
      }
      const wasOrphan = cur.orphan;
      next.orphan = false;
      if (changed || wasOrphan) { next.updatedAt = now; stats.updated++; }
      out.push(next);
    } else {
      out.push({
        id: newId(), weekId, origin: 'auto', key: n.key, ingredientId: n.ingredientId, dim: n.dim,
        name: ing ? ing.name : 'Ingrédient', category: (ing && ing.category) || 'Autres',
        needBase: n.needBase, stockBase: n.stockBase, toBuyBase: n.toBuyBase,
        optional: n.optionalOnly, recipeIds: n.recipeIds,
        qtyOverride: null, checked: false, checkedAt: null, note: '', removed: false, orphan: false,
        changedAfterCheck: null, categoryOverridden: false, createdAt: now, updatedAt: now,
      });
      stats.added++;
    }
  }
  // Articles auto qui ne correspondent plus à aucun repas.
  for (const it of byKey.values()) {
    const touched = it.checked || it.qtyOverride || (it.note && it.note.trim()) || it.categoryOverridden;
    if (it.removed || !touched) { stats.deleted++; continue; }
    if (!it.orphan) stats.orphaned++;
    out.push({ ...it, orphan: true, updatedAt: it.orphan ? it.updatedAt : now });
  }
  return { items: out, stats };
}

// Quantité effectivement à acheter pour un article (base), en tenant compte
// d'une quantité ajustée manuellement.
export function itemQtyBase(item) {
  if (item.qtyOverride && normalizeUnit(item.qtyOverride.unit) && item.qtyOverride.qty != null) {
    const b = toBase(item.qtyOverride.qty, item.qtyOverride.unit);
    if (!item.dim || b.dim === item.dim) return { qty: b.qty, dim: b.dim };
  }
  if (item.origin === 'manuel') {
    if (item.qty != null && normalizeUnit(item.unit)) { const b = toBase(item.qty, item.unit); return { qty: b.qty, dim: b.dim }; }
    return { qty: null, dim: null };
  }
  return { qty: item.toBuyBase, dim: item.dim };
}

// Prix estimé d'un article de la liste.
export function priceItem(item, ingredientsById, productsById) {
  if (item.origin === 'manuel') {
    const p = item.price;
    return { payable: (p == null || !isFinite(p)) ? null : Number(p), consumed: null, packs: [], manual: true };
  }
  const ing = get(ingredientsById, item.ingredientId);
  const { qty, dim } = itemQtyBase(item);
  const r = purchaseFor(ing, qty, dim, productsById);
  return r;
}

export function isActive(item) {
  return !item.removed && !(item.origin === 'auto' && !(itemQtyBase(item).qty > EPS));
}

// Budget de la liste.
export function listBudget(items, ingredientsById, productsById) {
  const b = {
    total: 0, checked: 0, remaining: 0, meals: 0, extras: 0,
    unknown: 0, unknownMeals: 0, unknownExtras: 0,
    count: 0, checkedCount: 0, consumed: 0, surplus: 0, stockValue: 0,
  };
  for (const it of items) {
    if (it.removed) continue;
    const ing = get(ingredientsById, it.ingredientId);
    if (it.origin === 'auto' && it.stockBase > EPS && ing) {
      const src = priceSourceFor(ing, productsById, it.dim);
      if (src) b.stockValue += it.stockBase * src.unitPrice;
    }
    if (!isActive(it)) continue;
    b.count++;
    if (it.checked) b.checkedCount++;
    const p = priceItem(it, ingredientsById, productsById);
    if (p.payable == null) {
      b.unknown++;
      if (it.origin === 'auto') b.unknownMeals++; else b.unknownExtras++;
      continue;
    }
    b.total += p.payable;
    if (it.checked) b.checked += p.payable; else b.remaining += p.payable;
    if (it.origin === 'auto') {
      b.meals += p.payable;
      if (p.consumed != null) b.consumed += p.consumed;
      b.surplus += Math.max(0, p.payable - (p.consumed ?? p.payable));
    } else b.extras += p.payable;
  }
  b.complete = b.unknown === 0;
  return b;
}

// Catégorie suggérée pour un article manuel tapé librement.
const HINTS = [
  [/papier|essuie|lessive|vaisselle|dentifrice|savon|shampo|poubelle|pile|éponge|eponge|javel|nettoy|déo|deo|rasoir|mouchoir|couche|coton|brosse|wc|adoucissant/i, 'Entretien et hygiène'],
  [/pomme|poire|banane|tomate|salade|carotte|oignon|ail|poireau|courgette|légume|legume|fruit|citron|orange|fraise|champignon|poivron|brocoli|chou|patate|pomme de terre|échalote/i, 'Fruits et légumes'],
  [/poulet|boeuf|bœuf|porc|viande|jambon|lardon|saucisse|haché|hache|poisson|saumon|thon|cabillaud|crevette|dinde/i, 'Viande et poisson'],
  [/lait|yaourt|yogourt|fromage|beurre|crème|creme|oeuf|œuf|mozzarella|emmental|skyr/i, 'Produits laitiers'],
  [/pain|baguette|croissant|pistolet|brioche/i, 'Boulangerie'],
  [/eau|bière|biere|vin|jus|soda|coca|café|cafe|thé|the |sirop/i, 'Boissons'],
  [/surgel|glace|frites surgel/i, 'Surgelés'],
  [/conserve|boîte|boite|concentré|pois chiches|haricots en/i, 'Conserves'],
  [/riz|pâtes|pates|farine|sucre|sel|huile|vinaigre|épice|epice|biscuit|céréale|cereale|chocolat|lentille|semoule/i, 'Épicerie sèche'],
];

export function guessCategory(name) {
  for (const [re, cat] of HINTS) if (re.test(name || '')) return cat;
  return 'Autres';
}

export function progress(items) {
  const act = items.filter(isActive);
  const done = act.filter(i => i.checked).length;
  return { done, total: act.length };
}
