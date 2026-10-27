// État de l'application (en mémoire) + opérations métier persistées.
// Toutes les écritures sont faites immédiatement dans IndexedDB ; les
// écritures liées sont groupées dans une même transaction.
import * as db from './db.js';
import { isoWeekId, compareWeeks } from './core/week.js';
import { computeNeeds, stockByKey, applyStock, reconcile, guessCategory, priceItem, itemQtyBase } from './core/shopping.js';
import { deductionForEntry, undoMovements } from './core/stock.js';
import { bestDisplay, normalizeUnit } from './core/units.js';
import { SCHEMA_VERSION, validateBackup } from './core/importexport.js';

export const DEFAULT_SETTINGS = {
  id: 'settings',
  stockEnabled: true,
  includeOptional: true,
  staleDays: 45,
  preferredStores: ['Colruyt', 'Intermarché'],
  priceCountry: 'BE',
  lastBackupAt: null,
  backupReminderDays: 14,
  demoLoaded: false,
  createdAt: null,
};

export const state = {
  ready: false,
  recipes: new Map(), ingredients: new Map(), products: new Map(), stock: new Map(),
  weeks: new Map(), shopping: new Map(), movements: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  ui: { id: 'ui' },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

export const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const nowISO = () => new Date().toISOString();
const clone = (o) => (typeof structuredClone === 'function') ? structuredClone(o) : JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------
export async function init() {
  const all = await db.loadAll();
  for (const k of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping', 'movements']) {
    state[k] = new Map(all[k].map(o => [o.id, o]));
  }
  const kv = new Map(all.kv.map(o => [o.id, o]));
  state.settings = { ...DEFAULT_SETTINGS, ...(kv.get('settings') || {}) };
  state.ui = { id: 'ui', ...(kv.get('ui') || {}) };
  if (!state.settings.createdAt) {
    state.settings.createdAt = nowISO();
    await db.write([{ store: 'kv', put: state.settings }]);
  }
  state.ready = true;
  emit('init');
}

function apply(ops) {
  // Reflète les opérations dans l'état mémoire (après succès de la transaction).
  for (const o of ops) {
    if (o.store === 'photos' || o.store === 'kv') continue;
    const m = state[o.store];
    if (o.clear) m.clear();
    else if (o.del !== undefined) m.delete(o.del);
    else m.set(o.put.id, o.put);
  }
}

async function commit(ops, what = 'data') {
  await db.write(ops);
  apply(ops);
  emit(what);
}

// --- Réglages et état d'interface ---------------------------------------------
export async function updateSettings(patch) {
  const next = { ...state.settings, ...patch };
  await db.write([{ store: 'kv', put: next }]);
  state.settings = next;
  emit('settings');
}

let uiTimer = null;
export function setUI(patch, { immediate = false, silent = false } = {}) {
  state.ui = { ...state.ui, ...patch };
  if (!silent && Object.keys(patch).length) emit('ui');
  clearTimeout(uiTimer);
  const save = () => db.write([{ store: 'kv', put: state.ui }]).catch(console.error);
  if (immediate) return save();
  uiTimer = setTimeout(save, 250);
}

// --- Lecture -------------------------------------------------------------------
export const currentWeekId = () => isoWeekId(new Date());
export const liveRecipes = () => [...state.recipes.values()].filter(r => !r.deletedAt);
export const sortedIngredients = () => [...state.ingredients.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

export function getWeek(id) {
  return state.weeks.get(id) || { id, entries: [], createdAt: null };
}

export function weekItems(weekId) {
  return [...state.shopping.values()].filter(i => i.weekId === weekId);
}

export function weekMovements(weekId) {
  return [...state.movements.values()].filter(m => m.weekId === weekId);
}

export function isPastWeek(id) { return compareWeeks(id, currentWeekId()) < 0; }

export function findIngredientByName(name) {
  const n = String(name || '').trim().toLocaleLowerCase('fr');
  if (!n) return null;
  for (const i of state.ingredients.values()) if (i.name.trim().toLocaleLowerCase('fr') === n) return i;
  return null;
}

export function recipeUsage(recipeId) {
  const weeks = [];
  for (const w of state.weeks.values()) if ((w.entries || []).some(e => e.recipeId === recipeId)) weeks.push(w.id);
  return weeks;
}

export function ingredientUsage(ingredientId) {
  const recipes = liveRecipes().filter(r => (r.items || []).some(it => it.ingredientId === ingredientId));
  const stock = [...state.stock.values()].filter(s => s.ingredientId === ingredientId);
  return { recipes, stock };
}

// --- Synchronisation des listes de courses ----------------------------------------
function syncOps(weekId, weekOverride) {
  const week = weekOverride || getWeek(weekId);
  const needs = computeNeeds(week.entries, state.recipes, { includeOptional: state.settings.includeOptional });
  const entryIds = new Set((week.entries || []).map(e => e.id));
  const stockMap = stockByKey([...state.stock.values()], weekMovements(weekId).filter(m => entryIds.has(m.entryId)));
  applyStock(needs, stockMap, state.settings.stockEnabled);
  const existing = weekItems(weekId);
  const { items, stats } = reconcile(existing, needs, { weekId, ingredientsById: state.ingredients, newId: uid });
  const keep = new Set(items.map(i => i.id));
  const ops = [];
  const before = new Map(existing.map(i => [i.id, JSON.stringify(i)]));
  for (const it of items) if (before.get(it.id) !== JSON.stringify(it)) ops.push({ store: 'shopping', put: it });
  for (const it of existing) if (!keep.has(it.id)) ops.push({ store: 'shopping', del: it.id });
  return { ops, stats };
}

export async function syncList(weekId) {
  const { ops, stats } = syncOps(weekId);
  const w = getWeek(weekId);
  if (w.createdAt) ops.push({ store: 'weeks', put: { ...w, listSyncedAt: nowISO() } });
  await commit(ops, 'shopping');
  return stats;
}

// Semaines à resynchroniser automatiquement : semaine courante et futures.
async function syncOpenWeeks(filter = () => true) {
  const cur = currentWeekId();
  for (const w of state.weeks.values()) {
    if (compareWeeks(w.id, cur) >= 0 && filter(w)) await syncList(w.id);
  }
}

// --- Planning --------------------------------------------------------------------
async function saveWeek(week, extraOps = []) {
  const w = { ...week, createdAt: week.createdAt || nowISO(), updatedAt: nowISO() };
  const { ops } = syncOps(w.id, w);
  await commit([...extraOps, { store: 'weeks', put: w }, ...ops], 'week');
  return w;
}

export async function addEntry(weekId, recipeId, { servings, day = null, slot = null } = {}) {
  const r = state.recipes.get(recipeId);
  if (!r) throw new Error('Recette introuvable');
  const w = clone(getWeek(weekId));
  w.entries.push({ id: uid(), recipeId, servings: servings || r.servings, day, slot, cooked: false, stockDeducted: false, addedAt: nowISO() });
  return saveWeek(w);
}

export async function updateEntry(weekId, entryId, patch) {
  const w = clone(getWeek(weekId));
  const e = w.entries.find(x => x.id === entryId);
  if (!e) return;
  Object.assign(e, patch);
  return saveWeek(w);
}

export async function removeEntry(weekId, entryId) {
  const w = clone(getWeek(weekId));
  w.entries = w.entries.filter(e => e.id !== entryId);
  // Les déductions de stock déjà faites restent (consommation réelle) mais ne
  // sont plus rattachées à la semaine.
  const mv = [...state.movements.values()].filter(m => m.entryId === entryId)
    .map(m => ({ store: 'movements', put: { ...m, weekId: null, detached: true } }));
  return saveWeek(w, mv);
}

export async function copyWeek(fromId, toId) {
  const src = getWeek(fromId);
  const dst = clone(getWeek(toId));
  for (const e of src.entries) {
    if (!state.recipes.get(e.recipeId) || state.recipes.get(e.recipeId).deletedAt) continue;
    dst.entries.push({ ...e, id: uid(), cooked: false, stockDeducted: false, addedAt: nowISO() });
  }
  return saveWeek(dst);
}

export async function ensureWeek(weekId) {
  if (state.weeks.has(weekId)) return state.weeks.get(weekId);
  return saveWeek({ id: weekId, entries: [] });
}

// Repas cuisiné, avec déduction facultative du stock (jamais deux fois).
export async function markCooked(weekId, entryId, { deduct }) {
  const w = clone(getWeek(weekId));
  const e = w.entries.find(x => x.id === entryId);
  if (!e) return { missing: [] };
  e.cooked = true;
  const ops = [];
  let missing = [];
  if (deduct && !e.stockDeducted) {
    const d = deductionForEntry(e, state.recipes, [...state.stock.values()]);
    missing = d.missing;
    for (const s of d.updates) ops.push({ store: 'stock', put: { ...s, updatedAt: nowISO() } });
    for (const m of d.movements) ops.push({ store: 'movements', put: { id: uid(), weekId, entryId, ...m, at: nowISO() } });
    e.stockDeducted = true;
  }
  w.updatedAt = nowISO();
  ops.push({ store: 'weeks', put: w });
  await commit(ops, 'week');
  return { missing };
}

export async function undoCooked(weekId, entryId) {
  const w = clone(getWeek(weekId));
  const e = w.entries.find(x => x.id === entryId);
  if (!e) return;
  const mvs = [...state.movements.values()].filter(m => m.entryId === entryId);
  const ups = undoMovements(mvs, [...state.stock.values()]);
  const ops = [
    ...ups.map(s => ({ store: 'stock', put: { ...s, updatedAt: nowISO() } })),
    ...mvs.map(m => ({ store: 'movements', del: m.id })),
  ];
  e.cooked = false; e.stockDeducted = false;
  ops.push({ store: 'weeks', put: { ...w, updatedAt: nowISO() } });
  await commit(ops, 'week');
}

// --- Recettes ----------------------------------------------------------------------
// draft.items : [{ ingredientId? , name, category, qty, unit, optional }]
export async function saveRecipe(draft, { photoBlob, removePhoto } = {}) {
  const ops = [];
  const existing = draft.id ? state.recipes.get(draft.id) : null;
  const r = {
    id: draft.id || uid(),
    name: draft.name.trim(), description: draft.description || '', servings: Number(draft.servings) || 1,
    prepMin: Number(draft.prepMin) || 0, cookMin: Number(draft.cookMin) || 0, category: draft.category || 'Autre',
    steps: (draft.steps || []).map(s => s.trim()).filter(Boolean), notes: draft.notes || '',
    photoId: existing ? existing.photoId || null : null,
    createdAt: existing ? existing.createdAt : nowISO(), updatedAt: nowISO(),
    demo: false, items: [],
  };
  const created = new Map();
  for (const it of draft.items || []) {
    let ingId = it.ingredientId && state.ingredients.has(it.ingredientId) ? it.ingredientId : null;
    if (!ingId) {
      const found = findIngredientByName(it.name) || created.get(it.name.trim().toLocaleLowerCase('fr'));
      if (found) ingId = found.id;
      else {
        const ing = { id: uid(), name: it.name.trim(), category: it.category || guessCategory(it.name), defaultUnit: it.unit, productIds: [], preferredProductId: null, manualPrice: null, unitWeight: null, createdAt: nowISO() };
        created.set(ing.name.toLocaleLowerCase('fr'), ing);
        ops.push({ store: 'ingredients', put: ing });
        ingId = ing.id;
      }
    }
    r.items.push({ id: it.id || uid(), ingredientId: ingId, qty: Number(it.qty), unit: normalizeUnit(it.unit), optional: !!it.optional, note: it.note || '' });
  }
  if (photoBlob) {
    const pid = uid();
    if (r.photoId) ops.push({ store: 'photos', del: r.photoId });
    ops.push({ store: 'photos', put: { id: pid, blob: photoBlob, type: photoBlob.type || 'image/jpeg' } });
    r.photoId = pid;
  } else if (removePhoto && r.photoId) {
    ops.push({ store: 'photos', del: r.photoId });
    r.photoId = null;
  }
  ops.push({ store: 'recipes', put: r });
  await commit(ops, 'recipes');
  photoCache.delete(existing && existing.photoId);
  if (existing) await syncOpenWeeks(w => (w.entries || []).some(e => e.recipeId === r.id));
  return r;
}

export async function duplicateRecipe(id) {
  const src = state.recipes.get(id);
  if (!src) return null;
  const copy = { ...clone(src), id: uid(), name: `${src.name} (copie)`, createdAt: nowISO(), updatedAt: nowISO(), demo: false };
  copy.items = copy.items.map(it => ({ ...it, id: uid() }));
  const ops = [];
  if (src.photoId) {
    const p = await db.get('photos', src.photoId);
    if (p) { const pid = uid(); ops.push({ store: 'photos', put: { ...p, id: pid } }); copy.photoId = pid; }
    else copy.photoId = null;
  }
  ops.push({ store: 'recipes', put: copy });
  await commit(ops, 'recipes');
  return copy;
}

// Suppression : définitive si la recette n'a jamais été planifiée ; sinon
// archivée (l'historique des semaines passées reste lisible) et retirée des
// semaines courante et futures.
export async function deleteRecipe(id) {
  const r = state.recipes.get(id);
  if (!r) return;
  const used = recipeUsage(id);
  const cur = currentWeekId();
  if (!used.length) {
    const ops = [{ store: 'recipes', del: id }];
    if (r.photoId) ops.push({ store: 'photos', del: r.photoId });
    await commit(ops, 'recipes');
    return { archived: false };
  }
  await commit([{ store: 'recipes', put: { ...r, deletedAt: nowISO() } }], 'recipes');
  for (const wid of used) {
    if (compareWeeks(wid, cur) < 0) continue;
    const w = clone(getWeek(wid));
    w.entries = w.entries.filter(e => e.recipeId !== id);
    await saveWeek(w);
  }
  return { archived: true, weeks: used.length };
}

// --- Ingrédients & produits -------------------------------------------------------
export async function saveIngredient(ing) {
  const prev = state.ingredients.get(ing.id);
  const next = { productIds: [], preferredProductId: null, manualPrice: null, unitWeight: null, ...prev, ...ing, updatedAt: nowISO() };
  if (!next.createdAt) next.createdAt = nowISO();
  await commit([{ store: 'ingredients', put: next }], 'ingredients');
  if (prev && (prev.name !== next.name || prev.category !== next.category)) await syncOpenWeeks();
  return next;
}

export async function createIngredient({ name, category, defaultUnit }) {
  const ex = findIngredientByName(name);
  if (ex) return ex;
  return saveIngredient({ id: uid(), name: name.trim(), category: category || guessCategory(name), defaultUnit: defaultUnit || 'g' });
}

export async function deleteIngredient(id) {
  const u = ingredientUsage(id);
  if (u.recipes.length || u.stock.length) {
    const parts = [];
    if (u.recipes.length) parts.push(`${u.recipes.length} recette(s)`);
    if (u.stock.length) parts.push(`le stock`);
    throw new Error(`Ingrédient utilisé dans ${parts.join(' et ')} : retirez-le d'abord.`);
  }
  await commit([{ store: 'ingredients', del: id }], 'ingredients');
}

export async function saveProduct(p, { linkIngredientId = null, preferred = false } = {}) {
  const prev = state.products.get(p.id);
  const next = { available: true, lot: 1, soldByWeight: false, autoUpdate: !!p.barcode, ...prev, ...p, updatedAt: nowISO() };
  if (!next.id) next.id = uid();
  if (!next.createdAt) next.createdAt = nowISO();
  if (prev && prev.packPrice !== next.packPrice) {
    next.priceHistory = [...(prev.priceHistory || []), { price: prev.packPrice, date: prev.priceDate, source: prev.priceSource }].slice(-20);
  }
  const ops = [{ store: 'products', put: next }];
  if (linkIngredientId) {
    const ing = state.ingredients.get(linkIngredientId);
    if (ing) {
      const ids = ing.productIds.includes(next.id) ? ing.productIds : [...ing.productIds, next.id];
      ops.push({ store: 'ingredients', put: { ...ing, productIds: ids, preferredProductId: preferred ? next.id : ing.preferredProductId, updatedAt: nowISO() } });
    }
  }
  await commit(ops, 'products');
  return next;
}

export async function linkProduct(ingredientId, productId, { preferred = false, unlink = false } = {}) {
  const ing = state.ingredients.get(ingredientId);
  if (!ing) return;
  let ids = ing.productIds || [];
  if (unlink) ids = ids.filter(x => x !== productId);
  else if (!ids.includes(productId)) ids = [...ids, productId];
  let pref = ing.preferredProductId;
  if (unlink && pref === productId) pref = null;
  if (preferred) pref = productId;
  if (preferred === null) pref = null;
  await commit([{ store: 'ingredients', put: { ...ing, productIds: ids, preferredProductId: pref, updatedAt: nowISO() } }], 'ingredients');
}

export async function setPreferredProduct(ingredientId, productId) {
  const ing = state.ingredients.get(ingredientId);
  if (!ing) return;
  await commit([{ store: 'ingredients', put: { ...ing, preferredProductId: productId || null, updatedAt: nowISO() } }], 'ingredients');
}

export async function deleteProduct(id) {
  const ops = [{ store: 'products', del: id }];
  for (const ing of state.ingredients.values()) {
    if ((ing.productIds || []).includes(id) || ing.preferredProductId === id) {
      ops.push({ store: 'ingredients', put: { ...ing, productIds: ing.productIds.filter(x => x !== id), preferredProductId: ing.preferredProductId === id ? null : ing.preferredProductId } });
    }
  }
  for (const s of state.stock.values()) if (s.productId === id) ops.push({ store: 'stock', put: { ...s, productId: null } });
  await commit(ops, 'products');
}

export function productsForIngredient(ingredientId) {
  const ing = state.ingredients.get(ingredientId);
  return ing ? (ing.productIds || []).map(id => state.products.get(id)).filter(Boolean) : [];
}

export function ingredientsForProduct(productId) {
  return [...state.ingredients.values()].filter(i => (i.productIds || []).includes(productId));
}

// --- Stock -------------------------------------------------------------------------
export async function saveStockItem(s) {
  const next = { id: s.id || uid(), ...s, qty: Number(s.qty) || 0, updatedAt: nowISO() };
  if (!next.createdAt) next.createdAt = nowISO();
  await commit([{ store: 'stock', put: next }], 'stock');
  await syncOpenWeeks();
  return next;
}

export async function deleteStockItem(id) {
  await commit([{ store: 'stock', del: id }], 'stock');
  await syncOpenWeeks();
}

// --- Liste de courses ------------------------------------------------------------------
export async function addManualItem(weekId, { name, category, qty = null, unit = null, price = null, note = '' }) {
  const n = String(name || '').trim();
  if (!n) throw new Error('Le nom est obligatoire.');
  const it = {
    id: uid(), weekId, origin: 'manuel', name: n, category: category || guessCategory(n),
    qty: qty === '' ? null : qty, unit: normalizeUnit(unit), price: price === '' ? null : price, note: note || '',
    checked: false, checkedAt: null, removed: false, createdAt: nowISO(), updatedAt: nowISO(),
  };
  await commit([{ store: 'shopping', put: it }], 'shopping');
  return it;
}

export async function updateItem(id, patch) {
  const it = state.shopping.get(id);
  if (!it) return;
  const next = { ...it, ...patch, updatedAt: nowISO() };
  if ('category' in patch && it.origin === 'auto' && patch.category !== it.category) next.categoryOverridden = true;
  if ('checked' in patch) next.checkedAt = patch.checked ? nowISO() : null;
  await commit([{ store: 'shopping', put: next }], 'item');
  return next;
}

export async function toggleItem(id) {
  const it = state.shopping.get(id);
  if (it) return updateItem(id, { checked: !it.checked });
}

export async function setChecked(ids, checked) {
  const ops = [];
  for (const id of ids) {
    const it = state.shopping.get(id);
    if (it && it.checked !== checked) ops.push({ store: 'shopping', put: { ...it, checked, checkedAt: checked ? nowISO() : null, updatedAt: nowISO() } });
  }
  await commit(ops, 'shopping');
}

export async function resetChecks(weekId) {
  return setChecked(weekItems(weekId).filter(i => i.checked).map(i => i.id), false);
}

export async function duplicateItem(id) {
  const it = state.shopping.get(id);
  if (!it) return;
  const base = it.origin === 'manuel' ? it : manualFromAuto(it);
  const copy = { ...base, id: uid(), origin: 'manuel', checked: false, checkedAt: null, createdAt: nowISO(), updatedAt: nowISO() };
  await commit([{ store: 'shopping', put: copy }], 'shopping');
  return copy;
}

function manualFromAuto(it) {
  const q = itemQtyBase(it);
  const d = q.qty != null ? bestDisplay(q.qty, q.dim) : { qty: null, unit: null };
  const p = priceItem(it, state.ingredients, state.products);
  return {
    weekId: it.weekId, origin: 'manuel', name: it.name, category: it.category,
    qty: d.qty, unit: d.unit, price: p.payable ?? null, note: it.note || '',
    checked: it.checked, checkedAt: it.checkedAt, removed: false, fromIngredientId: it.ingredientId,
  };
}

// Supprimer : un article manuel disparaît ; un article issu des repas est
// masqué (restaurable) pour ne pas réapparaître au prochain recalcul.
export async function removeItem(id) {
  const it = state.shopping.get(id);
  if (!it) return;
  if (it.origin === 'manuel' || it.orphan) await commit([{ store: 'shopping', del: id }], 'shopping');
  else await commit([{ store: 'shopping', put: { ...it, removed: true, checked: false, updatedAt: nowISO() } }], 'shopping');
}

export async function restoreItem(id) {
  const it = state.shopping.get(id);
  if (it) await commit([{ store: 'shopping', put: { ...it, removed: false, updatedAt: nowISO() } }], 'shopping');
}

// Article devenu inutile : le garder (converti en article manuel) ou le supprimer.
export async function resolveOrphan(id, keep) {
  const it = state.shopping.get(id);
  if (!it) return;
  if (!keep) return commit([{ store: 'shopping', del: id }], 'shopping');
  const m = { ...manualFromAuto(it), id: it.id, createdAt: it.createdAt, updatedAt: nowISO() };
  await commit([{ store: 'shopping', put: m }], 'shopping');
}

export async function ackChange(id) { return updateItem(id, { changedAfterCheck: null }); }

// --- Photos ---------------------------------------------------------------------------
const photoCache = new Map();
export async function photoURL(photoId) {
  if (!photoId) return null;
  if (photoCache.has(photoId)) return photoCache.get(photoId);
  const p = await db.get('photos', photoId);
  if (!p || !p.blob) return null;
  const url = URL.createObjectURL(p.blob);
  photoCache.set(photoId, url);
  return url;
}

// --- Sauvegarde / restauration ---------------------------------------------------------
async function blobToDataURL(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

function dataURLToBlob(url) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

export async function exportBackup({ includePhotos = true } = {}) {
  const photos = [];
  if (includePhotos) {
    for (const p of await db.getAll('photos')) {
      if (p.blob) photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
    }
  }
  const data = {};
  for (const k of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping', 'movements']) data[k] = [...state[k].values()];
  data.settings = state.settings;
  data.photos = photos;
  return { app: 'popote', schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), data };
}

export async function markBackupDone() { return updateSettings({ lastBackupAt: nowISO() }); }

export async function importBackup(obj) {
  const errors = validateBackup(obj);
  if (errors.length) throw new Error(errors.join('\n'));
  const d = obj.data;
  const ops = [];
  for (const s of db.STORES) if (s !== 'kv') ops.push({ store: s, clear: true });
  for (const k of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping', 'movements']) {
    for (const o of d[k] || []) ops.push({ store: k, put: o });
  }
  for (const p of d.photos || []) {
    const blob = dataURLToBlob(p.data);
    if (blob) ops.push({ store: 'photos', put: { id: p.id, blob, type: blob.type } });
  }
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}), id: 'settings' };
  ops.push({ store: 'kv', put: settings });
  await db.write(ops);
  photoCache.clear();
  apply(ops);
  state.settings = settings;
  emit('init');
}

// Import additif de recettes (format d'échange validé par importexport.js).
export async function importRecipes(drafts) {
  const out = [];
  for (const d of drafts) {
    const r = await saveRecipe({
      ...d, items: d.ingredients.map(i => ({ name: i.name, category: i.category, qty: i.qty, unit: i.unit, optional: i.optional })),
    });
    out.push(r);
  }
  return out;
}

export async function importProducts(list) {
  let linked = 0;
  for (const p of list) {
    const { ingredientName, ...prod } = p;
    let ing = ingredientName ? findIngredientByName(ingredientName) : null;
    if (ingredientName && !ing) ing = await createIngredient({ name: ingredientName, category: p.category, defaultUnit: p.packUnit });
    const existing = p.barcode ? [...state.products.values()].find(x => x.barcode === p.barcode && x.store === p.store) : null;
    // Ne remplace pas un prix plus récent par un plus ancien.
    if (existing && existing.priceDate && prod.priceDate && Date.parse(prod.priceDate) < Date.parse(existing.priceDate)) {
      prod.packPrice = existing.packPrice; prod.priceDate = existing.priceDate; prod.priceSource = existing.priceSource;
    }
    await saveProduct({ ...(existing || {}), ...prod, id: existing ? existing.id : uid() }, { linkIngredientId: ing ? ing.id : null });
    if (ing) linked++;
  }
  return { count: list.length, linked };
}

// --- Données de démonstration -------------------------------------------------------------
export async function removeDemo() {
  const ops = [];
  const demoRecipes = [...state.recipes.values()].filter(r => r.demo);
  const remaining = [...state.recipes.values()].filter(r => !r.demo);
  const usedIng = new Set(remaining.flatMap(r => (r.items || []).map(i => i.ingredientId)));
  for (const s of state.stock.values()) if (s.ingredientId) usedIng.add(s.ingredientId);
  for (const r of demoRecipes) {
    if (recipeUsage(r.id).length) ops.push({ store: 'recipes', put: { ...r, deletedAt: nowISO() } });
    else ops.push({ store: 'recipes', del: r.id });
  }
  for (const i of state.ingredients.values()) if (i.demo && !usedIng.has(i.id)) ops.push({ store: 'ingredients', del: i.id });
  for (const p of state.products.values()) if (p.demo) ops.push({ store: 'products', del: p.id });
  for (const s of state.stock.values()) if (s.demo) ops.push({ store: 'stock', del: s.id });
  // Nettoie les liens vers des produits démo supprimés
  for (const i of state.ingredients.values()) {
    if (i.demo && !usedIng.has(i.id)) continue;
    const ids = (i.productIds || []).filter(id => !(state.products.get(id) || {}).demo);
    if (ids.length !== (i.productIds || []).length) {
      ops.push({ store: 'ingredients', put: { ...i, productIds: ids, preferredProductId: ids.includes(i.preferredProductId) ? i.preferredProductId : null } });
    }
  }
  await commit(ops, 'data');
  await updateSettings({ demoLoaded: false });
  const cur = currentWeekId();
  for (const w of [...state.weeks.values()]) {
    if (compareWeeks(w.id, cur) < 0) continue;
    const kept = w.entries.filter(e => state.recipes.get(e.recipeId) && !state.recipes.get(e.recipeId).deletedAt);
    if (kept.length !== w.entries.length) await saveWeek({ ...w, entries: kept });
  }
}

export async function loadDemo(demo) {
  const ops = [];
  for (const k of ['ingredients', 'products', 'recipes', 'stock']) for (const o of demo[k] || []) ops.push({ store: k, put: { ...o, demo: true } });
  await commit(ops, 'data');
  await updateSettings({ demoLoaded: true });
  await syncOpenWeeks();
}

export { db };
