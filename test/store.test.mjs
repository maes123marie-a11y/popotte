// Tests de persistance (IndexedDB simulé) : H, J, K, L, suppressions, sauvegarde.
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import { resetDBHandle } from '../js/db.js';
import { currentWeekId } from '../js/store.js';
import { listBudget, progress } from '../js/core/shopping.js';
import { pickPrice, decidePriceUpdate, parseOFFQuantity } from '../js/core/priceupdate.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// Simule une fermeture complète de l'application : on oublie tout l'état mémoire
// et la connexion, puis on relit la base.
async function reopen() {
  const { openDB } = await import('../js/db.js');
  (await openDB()).close();
  resetDBHandle();
  for (const k of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping', 'movements']) S.state[k] = new Map();
  S.state.settings = {}; S.state.ui = {};
  await S.init();
}

const W = currentWeekId();
let riz, pates;

test('Préparation : init, recettes, produits', async () => {
  await S.init();
  riz = await S.saveRecipe({
    name: 'Riz aux légumes', servings: 2, prepMin: 10, cookMin: 20, category: 'Végétarien',
    steps: ['Cuire le riz', 'Sauter les légumes'],
    items: [
      { name: 'Riz', category: 'Épicerie sèche', qty: 200, unit: 'g' },
      { name: 'Légumes', category: 'Fruits et légumes', qty: 150, unit: 'g' },
    ],
  });
  pates = await S.saveRecipe({
    name: 'Pâtes', servings: 2, prepMin: 5, cookMin: 10, category: 'Pâtes',
    items: [{ name: 'riz', qty: 300, unit: 'g' }, { name: 'Oignon', qty: 1, unit: 'piece' }],
  });
  // « riz » réutilise l'ingrédient existant « Riz »
  assert.equal(S.state.ingredients.size, 3);
  const rizIng = S.findIngredientByName('Riz');
  const p = await S.saveProduct({ name: 'Riz 500 g', store: 'Colruyt', packQty: 500, packUnit: 'g', packPrice: 1.5, priceSource: 'manuel', priceDate: new Date().toISOString() }, { linkIngredientId: rizIng.id, preferred: true });
  assert.ok(S.state.ingredients.get(rizIng.id).productIds.includes(p.id));
});

test('Planning + liste de courses générée et regroupée', async () => {
  await S.addEntry(W, riz.id, {});
  await S.addEntry(W, pates.id, { day: 2, slot: 'soir' });
  const items = S.weekItems(W);
  const rizLine = items.find(i => i.name === 'Riz');
  close(rizLine.toBuyBase, 500);
  assert.equal(items.length, 3);
  const b = listBudget(items, S.state.ingredients, S.state.products);
  close(b.meals, 1.5); // 1 paquet de 500 g
  assert.equal(b.unknown, 2); // légumes et oignon sans prix
});

test('H/J/K — cases cochées et article manuel conservés après fermeture', async () => {
  const pq = await S.addManualItem(W, { name: 'Papier toilette' });
  assert.equal(pq.category, 'Entretien et hygiène');
  assert.equal(pq.price, null);
  await S.addManualItem(W, { name: 'Lessive', price: 8.99 });
  const rizLine = S.weekItems(W).find(i => i.name === 'Riz');
  await S.toggleItem(rizLine.id);
  await S.toggleItem(pq.id);
  await S.toggleItem(pq.id); // décoché
  await S.toggleItem(pq.id); // recoché
  S.setUI({ hideDone: true, collapsed: ['Boissons'] }, { immediate: true });
  await new Promise(r => setTimeout(r, 20));
  await reopen();
  const items = S.weekItems(W);
  assert.equal(items.length, 5);
  assert.equal(items.find(i => i.name === 'Riz').checked, true);
  assert.equal(items.find(i => i.name === 'Papier toilette').checked, true);
  assert.deepEqual(progress(items), { done: 2, total: 5 });
  close(listBudget(items, S.state.ingredients, S.state.products).extras, 8.99);
  assert.equal(S.state.ui.hideDone, true);
  assert.equal(S.state.recipes.get(riz.id).steps.length, 2);
});

test('Actualisation de prix : la liste et les cases ne sont pas modifiées', async () => {
  const before = JSON.stringify(S.weekItems(W).sort((a, b) => a.id.localeCompare(b.id)));
  const p = [...S.state.products.values()][0];
  await S.saveProduct({ ...p, packPrice: 1.65, priceDate: new Date().toISOString(), priceSource: 'Open Prices' });
  const after = JSON.stringify(S.weekItems(W).sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(after, before);
  close(listBudget(S.weekItems(W), S.state.ingredients, S.state.products).meals, 1.65);
  assert.equal(S.state.products.get(p.id).priceHistory.at(-1).price, 1.5);
});

test('L — modifier le planning après avoir commencé les courses', async () => {
  const e = S.getWeek(W).entries.find(x => x.recipeId === pates.id);
  await S.removeEntry(W, e.id);
  const items = S.weekItems(W);
  const rizLine = items.find(i => i.name === 'Riz');
  assert.equal(rizLine.checked, true);
  close(rizLine.toBuyBase, 200);
  close(rizLine.changedAfterCheck.fromBase, 500);
  assert.ok(!items.find(i => i.name === 'Oignon'), 'oignon non touché supprimé');
  assert.ok(items.find(i => i.name === 'Papier toilette'));
  assert.ok(items.find(i => i.name === 'Lessive'));
  // On remet les pâtes : l'oignon revient, le papier toilette reste
  await S.addEntry(W, pates.id, {});
  assert.ok(S.weekItems(W).find(i => i.name === 'Oignon'));
  assert.equal(S.weekItems(W).filter(i => i.name === 'Riz').length, 1);
});

test('Réinitialisation explicite des cases', async () => {
  await S.resetChecks(W);
  assert.equal(S.weekItems(W).filter(i => i.checked).length, 0);
  assert.equal(S.weekItems(W).length, 5);
});

test('Stock : déduit de la liste ; repas cuisiné déduit une seule fois', async () => {
  const rizIng = S.findIngredientByName('Riz');
  await S.saveStockItem({ ingredientId: rizIng.id, name: 'Riz', qty: 300, unit: 'g' });
  close(S.weekItems(W).find(i => i.name === 'Riz').toBuyBase, 200);
  const e = S.getWeek(W).entries.find(x => x.recipeId === riz.id);
  await S.markCooked(W, e.id, { deduct: true });
  await S.markCooked(W, e.id, { deduct: true }); // second appel sans effet
  const st = [...S.state.stock.values()][0];
  close(st.qty, 100);
  // La liste de la semaine ne gonfle pas après la déduction
  await S.syncList(W);
  close(S.weekItems(W).find(i => i.name === 'Riz').toBuyBase, 200);
  await S.undoCooked(W, e.id);
  close([...S.state.stock.values()][0].qty, 300);
  await S.updateSettings({ stockEnabled: false });
  await S.syncList(W);
  close(S.weekItems(W).find(i => i.name === 'Riz').toBuyBase, 500);
  await S.updateSettings({ stockEnabled: true });
});

test('Suppressions et données référencées', async () => {
  const rizIng = S.findIngredientByName('Riz');
  await assert.rejects(S.deleteIngredient(rizIng.id), /utilisé/);
  const solo = await S.saveRecipe({ name: 'Jamais planifiée', servings: 1, items: [] });
  assert.equal((await S.deleteRecipe(solo.id)).archived, false);
  assert.equal(S.state.recipes.has(solo.id), false);
  const r = await S.deleteRecipe(pates.id);
  assert.equal(r.archived, true);
  assert.ok(S.state.recipes.get(pates.id).deletedAt);
  assert.ok(!S.getWeek(W).entries.some(e => e.recipeId === pates.id));
  assert.ok(!S.liveRecipes().some(x => x.id === pates.id));
  const p = [...S.state.products.values()][0];
  await S.deleteProduct(p.id);
  assert.equal(S.state.ingredients.get(rizIng.id).preferredProductId, null);
  assert.equal(S.state.ingredients.get(rizIng.id).productIds.length, 0);
});

test('Sauvegarde complète : export puis restauration à l\'identique', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' });
  await S.saveRecipe({ ...riz, items: S.state.recipes.get(riz.id).items }, { photoBlob: blob });
  const backup = await S.exportBackup();
  const json = JSON.stringify(backup);
  const counts = Object.fromEntries(['recipes', 'ingredients', 'stock', 'weeks', 'shopping'].map(k => [k, S.state[k].size]));
  await S.addManualItem(W, { name: 'Ajout après sauvegarde' });
  await S.importBackup(JSON.parse(json));
  await reopen();
  for (const [k, n] of Object.entries(counts)) assert.equal(S.state[k].size, n, k);
  assert.ok(!S.weekItems(W).some(i => i.name === 'Ajout après sauvegarde'));
  const photo = await S.db.get('photos', S.state.recipes.get(riz.id).photoId);
  assert.deepEqual([...new Uint8Array(await photo.blob.arrayBuffer())], [1, 2, 3, 250]);
  await assert.rejects(S.importBackup({ app: 'autre' }), /sauvegarde/);
});

test('Open Prices : sélection du relevé belge et de l\'enseigne, jamais un prix plus ancien', () => {
  const items = [
    { id: 1, price: 2.1, date: '2026-10-01', currency: 'EUR', location: { osm_brand: 'Delhaize', osm_address_country_code: 'BE' } },
    { id: 2, price: 1.99, date: '2026-09-15', currency: 'EUR', location: { osm_brand: 'Colruyt', osm_address_city: 'Ans', osm_address_country_code: 'BE' } },
    { id: 3, price: 1.5, date: '2026-10-20', currency: 'EUR', location: { osm_brand: 'Colruyt', osm_address_country_code: 'FR' } },
  ];
  const pk = pickPrice(items, { country: 'BE', store: 'Colruyt' });
  assert.equal(pk.best.price, 1.99);
  assert.equal(pk.best.storeMatched, true);
  const other = pickPrice(items, { country: 'BE', store: 'Intermarché' });
  assert.equal(other.best.price, 2.1);
  assert.equal(other.best.storeMatched, false);
  assert.equal(pickPrice([], {}).best, null);
  const prod = { packQty: 1, packUnit: 'kg', packPrice: 2.2, priceDate: '2026-10-10T12:00:00Z', priceSource: 'Open Prices' };
  assert.equal(decidePriceUpdate(prod, pk.best).action, 'older');
  assert.equal(decidePriceUpdate({ ...prod, priceDate: '2026-09-01T12:00:00Z' }, pk.best).action, 'update');
  assert.equal(decidePriceUpdate({ ...prod, priceSource: 'manuel' }, pk.best).action, 'skip-manual');
  assert.equal(decidePriceUpdate(prod, null).action, 'notfound');
  const kg = decidePriceUpdate({ packQty: 500, packUnit: 'g', packPrice: null }, { price: 4, per: 'KILOGRAM', date: '2026-10-01' });
  close(kg.patch.packPrice, 2);
  assert.deepEqual(parseOFFQuantity({ quantity: '6 x 33 cl' }), { qty: 198, unit: 'cl' });
  assert.deepEqual(parseOFFQuantity({ product_quantity: 500, product_quantity_unit: 'g' }), { qty: 500, unit: 'g' });
});
