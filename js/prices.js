// Accès réseau aux données ouvertes Open Food Facts / Open Prices.
// Aucune clé, aucun compte : lecture publique uniquement (licence ODbL).
// Toute erreur réseau est rapportée sans bloquer l'application.
import { pickPrice, decidePriceUpdate, parseOFFQuantity } from './core/priceupdate.js';
import { state, saveProduct } from './store.js';

export const OPEN_PRICES = 'https://prices.openfoodfacts.org/api/v1/prices';
export const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product/';

async function fetchJSON(url, { timeout = 12000 } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Hors ligne');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Erreur ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Délai dépassé');
    if (e instanceof TypeError) throw new Error('Réseau indisponible ou accès refusé');
    throw e;
  } finally { clearTimeout(t); }
}

export const cleanBarcode = (s) => String(s || '').replace(/\D/g, '');

// Fiche produit Open Food Facts (nom, marque, contenance).
export async function lookupProduct(ean) {
  const code = cleanBarcode(ean);
  const d = await fetchJSON(`${OFF_PRODUCT}${code}.json?fields=code,product_name,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,image_front_small_url`);
  if (!d || d.status === 0 || !d.product) return null;
  const p = d.product;
  const q = parseOFFQuantity(p);
  return {
    barcode: code,
    name: p.product_name_fr || p.product_name || '',
    brand: String(p.brands || '').split(',')[0].trim(),
    packQty: q ? q.qty : null, packUnit: q ? q.unit : null,
    image: p.image_front_small_url || '',
    url: `https://world.openfoodfacts.org/product/${code}`,
  };
}

export async function fetchObservations(ean) {
  const code = cleanBarcode(ean);
  const d = await fetchJSON(`${OPEN_PRICES}?product_code=${code}&currency=EUR&order_by=-date&size=100`);
  return (d && d.items) || [];
}

export async function bestPriceFor(ean, store) {
  const items = await fetchObservations(ean);
  return pickPrice(items, { country: state.settings.priceCountry || 'BE', store, preferredStores: state.settings.preferredStores });
}

// Actualise un produit. Ne touche jamais aux listes de courses : le budget est
// recalculé à l'affichage à partir des nouveaux prix, sans toucher aux cases.
export async function refreshProduct(product) {
  if (!product.barcode) return { product, action: 'no-barcode' };
  const pick = await bestPriceFor(product.barcode, product.store);
  const d = decidePriceUpdate(product, pick.best);
  const checked = { lastCheckedAt: new Date().toISOString(), lastCheckResult: d.action };
  if (d.action === 'update') {
    const p = await saveProduct({ ...product, ...d.patch, ...checked });
    return { product: p, action: 'update', obs: d.obs, pick };
  }
  const p = await saveProduct({ ...product, ...checked });
  return { product: p, action: d.action, obs: d.obs, pick };
}

export async function refreshAll(onProgress = () => {}) {
  const list = [...state.products.values()].filter(p => p.barcode && p.autoUpdate !== false && !p.demo);
  const res = { update: 0, unchanged: 0, older: 0, notfound: 0, error: 0, skipped: 0, total: list.length, errors: [] };
  let i = 0;
  for (const p of list) {
    onProgress(++i, list.length, p);
    try {
      const r = await refreshProduct(p);
      if (r.action === 'update') res.update++;
      else if (r.action === 'unchanged') res.unchanged++;
      else if (r.action === 'older') res.older++;
      else if (r.action === 'notfound') res.notfound++;
      else res.skipped++;
    } catch (e) {
      res.error++; res.errors.push(`${p.name} : ${e.message}`);
      if (/Hors ligne/.test(e.message)) { res.error += list.length - i; break; }
    }
  }
  return res;
}
