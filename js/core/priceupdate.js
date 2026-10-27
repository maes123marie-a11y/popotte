// Choix d'un relevé de prix Open Prices et décision de mise à jour (pur, testable).
import { toBase, dimOf } from './units.js';

const lc = (s) => String(s || '').toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function storeMatches(location, storeName) {
  if (!storeName) return false;
  const want = lc(storeName).replace(/\s+/g, '');
  const hay = [location && location.osm_brand, location && location.osm_name, location && location.osm_display_name]
    .map(x => lc(x).replace(/\s+/g, '')).join(' ');
  return want.length > 2 && hay.includes(want);
}

// items : prix bruts de l'API Open Prices.
// Renvoie { best, inCountry, matching } avec best = relevé retenu ou null.
export function pickPrice(items, { country = 'BE', store = '', preferredStores = [] } = {}) {
  const valid = (items || []).filter(p => p && isFinite(Number(p.price)) && Number(p.price) > 0 && p.date &&
    (!p.currency || p.currency === 'EUR'));
  const loc = (p) => p.location || {};
  const inCountry = valid.filter(p => String(loc(p).osm_address_country_code || '').toUpperCase() === country);
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  inCountry.sort(byDate);
  const wanted = store ? [store] : preferredStores;
  const matching = inCountry.filter(p => wanted.some(s => storeMatches(loc(p), s)));
  const best = matching[0] || inCountry[0] || null;
  return {
    best: best ? normalizeObservation(best, !!matching[0]) : null,
    inCountry: inCountry.length, matching: matching.length,
  };
}

export function normalizeObservation(p, storeMatched) {
  const l = p.location || {};
  return {
    price: Number(p.price),
    per: p.price_per || 'UNIT', // UNIT | KILOGRAM | LITRE (produits bruts)
    date: p.date, // AAAA-MM-JJ
    discounted: !!p.price_is_discounted,
    storeName: l.osm_brand || l.osm_name || '',
    city: l.osm_address_city || '',
    storeMatched,
    priceId: p.id,
  };
}

// Calcule le nouveau prix de conditionnement à partir d'une observation.
export function packPriceFrom(obs, product) {
  if (obs.per === 'KILOGRAM' || obs.per === 'LITRE') {
    const dim = dimOf(product.packUnit);
    if ((obs.per === 'KILOGRAM' && dim !== 'masse') || (obs.per === 'LITRE' && dim !== 'volume')) return null;
    return obs.price * toBase(product.packQty, product.packUnit).qty / 1000;
  }
  return obs.price;
}

// Décision : ne jamais remplacer silencieusement un prix plus récent, ni un prix manuel.
export function decidePriceUpdate(product, obs) {
  if (!obs) return { action: 'notfound' };
  if (product.priceSource === 'manuel' && !product.autoUpdate) return { action: 'skip-manual', obs };
  const newPack = packPriceFrom(obs, product);
  if (newPack == null) return { action: 'incompatible', obs };
  const obsTime = Date.parse(obs.date + 'T12:00:00');
  const curTime = product.priceDate ? Date.parse(product.priceDate) : NaN;
  if (isFinite(curTime) && obsTime < curTime - 86400000 && product.packPrice != null) return { action: 'older', obs };
  if (product.packPrice != null && Math.abs(product.packPrice - newPack) < 0.005 && isFinite(curTime) &&
      String(product.priceDate).slice(0, 10) === obs.date) return { action: 'unchanged', obs };
  return {
    action: 'update', obs,
    patch: {
      packPrice: newPack,
      priceDate: new Date(obsTime).toISOString(),
      priceSource: 'Open Prices',
      priceNote: `${obs.storeName || 'magasin'}${obs.city ? ' (' + obs.city + ')' : ''}${obs.discounted ? ' · promo' : ''}${obs.storeMatched ? '' : ' · autre enseigne'}`,
      priceRef: obs.priceId,
    },
  };
}

// Analyse de la contenance Open Food Facts (« 500 g », « 1,5 L », « 6 x 33 cl »).
export function parseOFFQuantity(p) {
  if (p && Number(p.product_quantity) > 0 && p.product_quantity_unit) {
    const u = String(p.product_quantity_unit).toLowerCase();
    if (['g', 'kg', 'ml', 'cl', 'l'].includes(u)) return { qty: Number(p.product_quantity), unit: u };
  }
  const s = String((p && p.quantity) || '').toLowerCase().replace(',', '.');
  let m = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/.exec(s);
  if (m) return { qty: Number(m[1]) * Number(m[2]), unit: m[3] };
  m = /(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/.exec(s);
  if (m) return { qty: Number(m[1]), unit: m[2] };
  return null;
}
