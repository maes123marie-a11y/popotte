// Prix des produits, coût des ingrédients et des recettes.
import { toBase, dimOf, normalizeUnit } from './units.js';
import { optimizePurchase } from './packaging.js';

export const DAY_MS = 86400000;
export const PRICE_STATUS = {
  verifie: 'Vérifié', ancien: 'Ancien', manuel: 'Manuel', indisponible: 'Indisponible',
};

export function productHasPrice(p) {
  return !!p && p.available !== false && isFinite(p.packPrice) && p.packPrice !== null &&
    isFinite(p.packQty) && p.packQty > 0 && !!normalizeUnit(p.packUnit);
}

// Statut d'un prix à l'instant `now` (ms) selon le seuil d'ancienneté (jours).
export function priceStatus(p, now = Date.now(), staleDays = 45) {
  if (!productHasPrice(p)) return 'indisponible';
  if (p.priceSource === 'manuel') return 'manuel';
  const t = p.priceDate ? Date.parse(p.priceDate) : NaN;
  if (!isFinite(t)) return 'ancien';
  return (now - t) > staleDays * DAY_MS ? 'ancien' : 'verifie';
}

// Prix par unité de base (€/g, €/ml, €/pièce)
export function unitPriceBase(p) {
  if (!productHasPrice(p)) return null;
  const b = toBase(p.packQty, p.packUnit);
  return p.packPrice / b.qty;
}

// Prix affiché au kg / l / pièce.
export function referencePrice(p) {
  const u = unitPriceBase(p);
  if (u == null) return null;
  const dim = dimOf(p.packUnit);
  if (dim === 'masse') return { price: u * 1000, per: 'kg' };
  if (dim === 'volume') return { price: u * 1000, per: 'l' };
  return { price: u, per: dim === 'piece' ? 'unité' : p.packUnit };
}

// Convertit une quantité de base d'une dimension vers une autre via la
// correspondance déclarée par l'utilisateur sur l'ingrédient (poids d'une pièce).
// Renvoie { qty, estimated } ou null.
export function convertForIngredient(qtyBase, fromDim, toDim, ingredient) {
  if (fromDim === toDim) return { qty: qtyBase, estimated: false };
  const w = ingredient && ingredient.unitWeight;
  if (!w || !(w.qty > 0) || !normalizeUnit(w.unit)) return null;
  const wb = toBase(w.qty, w.unit); // contenance d'UNE pièce
  if (fromDim === 'piece' && toDim === wb.dim) return { qty: qtyBase * wb.qty, estimated: true };
  if (toDim === 'piece' && fromDim === wb.dim) return { qty: qtyBase / wb.qty, estimated: true };
  return null;
}

// Produits associés à un ingrédient, utilisables (prix connu), compatibles avec dim.
export function usableProducts(ingredient, productsById, dim) {
  if (!ingredient) return [];
  const ids = ingredient.productIds || [];
  const out = [];
  for (const id of ids) {
    const p = productsById.get ? productsById.get(id) : productsById[id];
    if (!productHasPrice(p)) continue;
    const pdim = dimOf(p.packUnit);
    if (pdim === dim || convertForIngredient(1, dim, pdim, ingredient)) out.push(p);
  }
  return out;
}

function getProduct(productsById, id) {
  return productsById.get ? productsById.get(id) : productsById[id];
}

// Source de prix choisie pour un ingrédient dans une dimension donnée :
// 1) produit privilégié s'il a un prix, 2) produit associé le moins cher au
// prix unitaire, 3) prix manuel de l'ingrédient. Sinon null.
export function priceSourceFor(ingredient, productsById, dim) {
  if (!ingredient) return null;
  const cands = usableProducts(ingredient, productsById, dim);
  const pref = ingredient.preferredProductId && cands.find(p => p.id === ingredient.preferredProductId);
  const perBase = (p) => {
    const u = unitPriceBase(p);
    const c = convertForIngredient(1, dim, dimOf(p.packUnit), ingredient);
    return { unit: u * c.qty, estimated: c.estimated };
  };
  if (pref) { const r = perBase(pref); return { type: 'produit', product: pref, unitPrice: r.unit, estimated: r.estimated }; }
  if (cands.length) {
    let best = null;
    for (const p of cands) {
      const r = perBase(p);
      if (!best || r.unit < best.unitPrice) best = { type: 'produit', product: p, unitPrice: r.unit, estimated: r.estimated };
    }
    return best;
  }
  const m = ingredient.manualPrice;
  if (m && isFinite(m.price) && m.price !== null && m.qty > 0 && normalizeUnit(m.unit)) {
    const b = toBase(m.qty, m.unit);
    const conv = convertForIngredient(1, dim, b.dim, ingredient);
    if (conv) return { type: 'manuel', unitPrice: (m.price / b.qty) * conv.qty, estimated: conv.estimated };
  }
  return null;
}

// Coût consommé d'une quantité d'ingrédient.
export function lineCost(ingredient, qty, unit, productsById) {
  const n = normalizeUnit(unit);
  if (!n || !(qty >= 0)) return { cost: null, reason: 'unité inconnue' };
  const b = toBase(qty, n);
  const src = priceSourceFor(ingredient, productsById, b.dim);
  if (!src) {
    const hasAny = ingredient && ((ingredient.productIds || []).length || ingredient.manualPrice);
    return { cost: null, qtyBase: b.qty, dim: b.dim, reason: hasAny ? 'unité incompatible ou prix manquant' : 'prix inconnu' };
  }
  return { cost: b.qty * src.unitPrice, qtyBase: b.qty, dim: b.dim, source: src };
}

// Coût d'une recette pour un nombre de portions (sans modifier la recette).
export function recipeCost(recipe, servings, ingredientsById, productsById) {
  const ref = recipe.servings > 0 ? recipe.servings : 1;
  const s = servings > 0 ? servings : ref;
  const factor = s / ref;
  const lines = (recipe.items || []).map(it => {
    const ing = ingredientsById.get ? ingredientsById.get(it.ingredientId) : ingredientsById[it.ingredientId];
    const qty = Number(it.qty) * factor;
    const c = lineCost(ing, qty, it.unit, productsById);
    return { item: it, ingredient: ing, qty, unit: it.unit, ...c };
  });
  const known = lines.filter(l => l.cost != null);
  const total = known.reduce((a, l) => a + l.cost, 0);
  for (const l of lines) l.share = (l.cost != null && total > 0) ? l.cost / total : null;
  const unknown = lines.filter(l => l.cost == null);
  return {
    servings: s, factor, lines,
    total, perServing: total / s,
    unknownCount: unknown.length, complete: unknown.length === 0 && lines.length > 0,
    estimated: lines.some(l => l.source && l.source.estimated),
  };
}

// Montant à payer en caisse pour une quantité à acheter d'un ingrédient.
export function purchaseFor(ingredient, qtyBase, dim, productsById) {
  if (!(qtyBase > 0)) return { payable: 0, consumed: 0, packs: [], surplus: 0 };
  const src = priceSourceFor(ingredient, productsById, dim);
  let products = usableProducts(ingredient, productsById, dim);
  // Produit privilégié : on n'achète que lui (choix explicite de l'utilisateur).
  if (ingredient && ingredient.preferredProductId) {
    const pref = products.find(p => p.id === ingredient.preferredProductId);
    if (pref) products = [pref];
  }
  const options = [];
  let estimated = false;
  for (const p of products) {
    const pb = toBase(p.packQty, p.packUnit);
    // Conditionnement exprimé dans la dimension du besoin.
    const conv = convertForIngredient(pb.qty, pb.dim, dim, ingredient);
    if (!conv) continue;
    if (conv.estimated) estimated = true;
    options.push({ productId: p.id, packQtyBase: conv.qty, packPrice: p.packPrice, soldByWeight: !!p.soldByWeight, lot: p.lot || 1 });
  }
  const best = optimizePurchase(qtyBase, options);
  if (best) {
    const consumed = src ? qtyBase * src.unitPrice : null;
    return { ...best, consumed, estimated, source: src };
  }
  if (src && src.type === 'manuel') {
    // Prix manuel « au poids » : pas de conditionnement connu.
    const v = qtyBase * src.unitPrice;
    return { payable: v, consumed: v, packs: [], surplus: 0, estimated: src.estimated, source: src, noPack: true };
  }
  return { payable: null, consumed: null, packs: [], surplus: 0, source: null };
}

export function describePacks(packs, productsById) {
  return (packs || []).map(p => {
    const prod = getProduct(productsById, p.productId);
    const name = prod ? prod.name : 'Produit';
    if (p.bulk) return `${name} (au détail)`;
    return `${p.count} × ${name}`;
  }).join(' + ');
}
