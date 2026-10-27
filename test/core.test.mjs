// Tests du noyau de calcul — critères d'acceptation A à M et cas limites.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { convert, sumQuantities, toBase, compatible, normalizeUnit, formatBase } from '../js/core/units.js';
import { round2, formatEUR, parseAmount, parseQty } from '../js/core/money.js';
import { recipeCost, lineCost, purchaseFor, priceStatus, referencePrice, DAY_MS } from '../js/core/costing.js';
import { optimizePurchase } from '../js/core/packaging.js';
import { computeNeeds, stockByKey, applyStock, reconcile, listBudget, progress, guessCategory, priceItem, isActive } from '../js/core/shopping.js';
import { deductionForEntry, undoMovements } from '../js/core/stock.js';
import { weekSummary } from '../js/core/budget.js';
import { isoWeekId, weekStart, addWeeks } from '../js/core/week.js';
import { parseRecipesCSV, parseRecipesJSON, parseProductsCSV, parseCSV, toCSV, validateBackup } from '../js/core/importexport.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
let seq = 0; const newId = () => `id${++seq}`;

// --- Données de test ----------------------------------------------------------
const NOW = Date.parse('2026-10-27T10:00:00Z');
const fresh = new Date(NOW - DAY_MS).toISOString();
const products = new Map([
  ['p-riz-kg', { id: 'p-riz-kg', name: 'Riz vrac', packQty: 1, packUnit: 'kg', packPrice: 2.5, soldByWeight: true, priceDate: fresh, priceSource: 'test' }],
  ['p-leg-kg', { id: 'p-leg-kg', name: 'Légumes', packQty: 1, packUnit: 'kg', packPrice: 3.0, soldByWeight: true, priceDate: fresh, priceSource: 'test' }],
  ['p-riz-500', { id: 'p-riz-500', name: 'Riz 500 g', packQty: 500, packUnit: 'g', packPrice: 1.5, priceDate: fresh, priceSource: 'test' }],
]);
const ingredients = new Map([
  ['riz', { id: 'riz', name: 'Riz', category: 'Épicerie sèche', productIds: ['p-riz-kg'] }],
  ['leg', { id: 'leg', name: 'Légumes', category: 'Fruits et légumes', productIds: ['p-leg-kg'] }],
  ['riz500', { id: 'riz500', name: 'Riz', category: 'Épicerie sèche', productIds: ['p-riz-500'] }],
  ['oignon', { id: 'oignon', name: 'Oignon jaune', category: 'Fruits et légumes', productIds: [] }],
  ['oignonR', { id: 'oignonR', name: 'Oignon rouge', category: 'Fruits et légumes', productIds: [] }],
  ['lait', { id: 'lait', name: 'Lait', category: 'Produits laitiers', productIds: [], manualPrice: { price: 1.2, qty: 1, unit: 'l' } }],
  ['sel', { id: 'sel', name: 'Sel', category: 'Épicerie sèche', productIds: [] }],
]);
const recipeA = {
  id: 'rA', name: 'Riz aux légumes', servings: 2, prepMin: 10, cookMin: 20,
  items: [
    { ingredientId: 'riz', qty: 200, unit: 'g' },
    { ingredientId: 'leg', qty: 150, unit: 'g' },
  ],
};

// --- Test A ----------------------------------------------------------------------
test('A — coût d\'une recette : 0,95 € pour 2, soit 0,475 €/personne', () => {
  const c = recipeCost(recipeA, 2, ingredients, products);
  close(c.total, 0.95);
  close(c.perServing, 0.475);
  assert.equal(c.complete, true);
  assert.equal(formatEUR(c.total).replace(/\s/g, ' '), '0,95 €');
  close(c.lines[0].share + c.lines[1].share, 1);
});

// --- Test B ----------------------------------------------------------------------
test('B — passer à 4 portions double quantités et coût sans modifier la recette', () => {
  const before = JSON.stringify(recipeA);
  const c = recipeCost(recipeA, 4, ingredients, products);
  close(c.total, 1.9);
  close(c.lines[0].qty, 400);
  close(c.lines[1].qty, 300);
  close(c.perServing, 0.475);
  assert.equal(JSON.stringify(recipeA), before);
});

// --- Test C ----------------------------------------------------------------------
test('C — 200 g + 300 g de riz = 500 g sur une seule ligne', () => {
  const r1 = { id: 'r1', servings: 2, items: [{ ingredientId: 'riz', qty: 200, unit: 'g' }] };
  const r2 = { id: 'r2', servings: 2, items: [{ ingredientId: 'riz', qty: 300, unit: 'g' }] };
  const needs = computeNeeds([{ recipeId: 'r1', servings: 2 }, { recipeId: 'r2', servings: 2 }], new Map([['r1', r1], ['r2', r2]]));
  assert.equal(needs.size, 1);
  const n = [...needs.values()][0];
  close(n.needBase, 500);
  assert.deepEqual(n.recipeIds, ['r1', 'r2']);
});

test('C bis — oignons : 2 + 1 + 3 = 6, oignon rouge distinct de l\'oignon jaune', () => {
  const rs = new Map([
    ['a', { id: 'a', servings: 1, items: [{ ingredientId: 'oignon', qty: 2, unit: 'piece' }] }],
    ['b', { id: 'b', servings: 1, items: [{ ingredientId: 'oignon', qty: 1, unit: 'piece' }, { ingredientId: 'oignonR', qty: 1, unit: 'piece' }] }],
    ['c', { id: 'c', servings: 1, items: [{ ingredientId: 'oignon', qty: 3, unit: 'piece' }] }],
  ]);
  const needs = computeNeeds(['a', 'b', 'c'].map(id => ({ recipeId: id, servings: 1 })), rs);
  close(needs.get('oignon|piece').needBase, 6);
  close(needs.get('oignonR|piece').needBase, 1);
  assert.equal(needs.size, 2);
});

test('C ter — unités incompatibles du même ingrédient : lignes séparées', () => {
  const rs = new Map([
    ['a', { id: 'a', servings: 1, items: [{ ingredientId: 'sel', qty: 10, unit: 'g' }] }],
    ['b', { id: 'b', servings: 1, items: [{ ingredientId: 'sel', qty: 1, unit: 'pincee' }] }],
  ]);
  const needs = computeNeeds([{ recipeId: 'a' }, { recipeId: 'b' }], rs);
  assert.equal(needs.size, 2);
});

// --- Test D ----------------------------------------------------------------------
test('D — besoin 500 g, stock 300 g : 200 g à acheter', () => {
  const r = { id: 'r', servings: 1, items: [{ ingredientId: 'riz', qty: 500, unit: 'g' }] };
  const needs = computeNeeds([{ recipeId: 'r', servings: 1 }], new Map([['r', r]]));
  applyStock(needs, stockByKey([{ id: 's1', ingredientId: 'riz', qty: 300, unit: 'g' }]));
  const n = needs.get('riz|masse');
  close(n.toBuyBase, 200);
  close(n.stockBase, 300);
});

test('D bis — stock en kg déduit d\'un besoin en g ; gestion du stock désactivable', () => {
  const r = { id: 'r', servings: 1, items: [{ ingredientId: 'riz', qty: 500, unit: 'g' }] };
  const needs = computeNeeds([{ recipeId: 'r' }], new Map([['r', r]]));
  applyStock(needs, stockByKey([{ id: 's', ingredientId: 'riz', qty: 0.1, unit: 'kg' }]));
  close(needs.get('riz|masse').toBuyBase, 400);
  applyStock(needs, stockByKey([{ id: 's', ingredientId: 'riz', qty: 0.1, unit: 'kg' }]), false);
  close(needs.get('riz|masse').toBuyBase, 500);
});

// --- Test E ----------------------------------------------------------------------
test('E — 200 g, paquet de 500 g à 1,50 € : 1,50 € en caisse, 0,60 € consommé', () => {
  const r = purchaseFor(ingredients.get('riz500'), 200, 'masse', products);
  close(r.payable, 1.5);
  close(r.consumed, 0.6);
  close(r.surplus, 300);
  assert.equal(r.packs[0].count, 1);
});

test('E bis — combinaison optimale de conditionnements', () => {
  const opts = [
    { productId: 'small', packQtyBase: 250, packPrice: 1.0 },
    { productId: 'big', packQtyBase: 1000, packPrice: 3.0 },
  ];
  // 1100 g : 1×1 kg + 1×250 g = 4,00 € (mieux que 5×250 g = 5,00 € ou 2 kg = 6,00 €)
  const r = optimizePurchase(1100, opts);
  close(r.payable, 4.0);
  // 700 g : 3×250 g = 3,00 € vs 1 kg = 3,00 € → même prix, on garde le moins de surplus (750 g)
  const r2 = optimizePurchase(700, opts);
  close(r2.payable, 3.0);
  close(r2.purchasedQty, 750);
  // Lot minimal : yaourts vendus par 4
  const r3 = optimizePurchase(3, [{ productId: 'y', packQtyBase: 1, packPrice: 0.5, lot: 4 }]);
  close(r3.payable, 2.0);
  assert.equal(r3.packs[0].count, 4);
  // Produit indisponible ignoré, aucune option → null
  assert.equal(optimizePurchase(100, []), null);
  assert.deepEqual(optimizePurchase(0, opts).payable, 0);
});

// --- Test F ----------------------------------------------------------------------
test('F — prix manquant signalé, total marqué incomplet, prix manuel pris en compte', () => {
  const r = { id: 'r', servings: 2, items: [...recipeA.items, { ingredientId: 'oignon', qty: 1, unit: 'piece' }] };
  const c = recipeCost(r, 2, ingredients, products);
  assert.equal(c.complete, false);
  assert.equal(c.unknownCount, 1);
  close(c.total, 0.95); // total des prix connus uniquement
  assert.equal(c.lines[2].cost, null);
  // Saisie manuelle d'un prix → complet
  const ings = new Map(ingredients);
  ings.set('oignon', { ...ingredients.get('oignon'), manualPrice: { price: 0.3, qty: 1, unit: 'piece' } });
  const c2 = recipeCost(r, 2, ings, products);
  assert.equal(c2.complete, true);
  close(c2.total, 1.25);
  // Prix manuel au litre utilisé pour des ml
  close(lineCost(ingredients.get('lait'), 250, 'ml', products).cost, 0.3);
});

test('F bis — liste : un article sans prix n\'est pas compté comme gratuit', () => {
  const items = [
    { id: 'a', origin: 'auto', ingredientId: 'oignon', dim: 'piece', toBuyBase: 3, checked: false },
    { id: 'b', origin: 'manuel', name: 'Papier toilette', price: null, checked: false },
    { id: 'c', origin: 'manuel', name: 'Lessive', price: 8.99, checked: true },
  ];
  const b = listBudget(items, ingredients, products);
  assert.equal(b.unknown, 2);
  assert.equal(b.complete, false);
  close(b.total, 8.99);
  close(b.checked, 8.99);
  close(b.extras, 8.99);
});

// --- Statut des prix ------------------------------------------------------------
test('Statut des prix : vérifié, ancien, manuel, indisponible ; prix de référence', () => {
  const p = { packQty: 500, packUnit: 'g', packPrice: 1.5, priceDate: fresh, priceSource: 'Open Prices' };
  assert.equal(priceStatus(p, NOW, 45), 'verifie');
  assert.equal(priceStatus({ ...p, priceDate: new Date(NOW - 60 * DAY_MS).toISOString() }, NOW, 45), 'ancien');
  assert.equal(priceStatus({ ...p, priceSource: 'manuel' }, NOW), 'manuel');
  assert.equal(priceStatus({ ...p, packPrice: null }, NOW), 'indisponible');
  assert.equal(priceStatus({ ...p, available: false }, NOW), 'indisponible');
  const ref = referencePrice(p);
  close(ref.price, 3.0); assert.equal(ref.per, 'kg');
});

// --- Test I ----------------------------------------------------------------------
test('I — retirer un repas recalcule liste et budget sans doublon', () => {
  const rs = new Map([
    ['r1', { id: 'r1', servings: 2, items: [{ ingredientId: 'riz', qty: 200, unit: 'g' }] }],
    ['r2', { id: 'r2', servings: 2, items: [{ ingredientId: 'riz', qty: 300, unit: 'g' }, { ingredientId: 'leg', qty: 100, unit: 'g' }] }],
  ]);
  const opt = { weekId: '2026-W44', ingredientsById: ingredients, newId };
  let entries = [{ recipeId: 'r1', servings: 2 }, { recipeId: 'r2', servings: 2 }];
  let { items } = reconcile([], applyStock(computeNeeds(entries, rs), new Map()), opt);
  assert.equal(items.length, 2);
  close(listBudget(items, ingredients, products).total, 0.5 * 2.5 + 0.1 * 3);
  // Même calcul deux fois : aucun doublon
  ({ items } = reconcile(items, applyStock(computeNeeds(entries, rs), new Map()), opt));
  assert.equal(items.length, 2);
  entries = [{ recipeId: 'r1', servings: 2 }];
  ({ items } = reconcile(items, applyStock(computeNeeds(entries, rs), new Map()), opt));
  assert.equal(items.length, 1);
  close(items[0].toBuyBase, 200);
  close(listBudget(items, ingredients, products).total, 0.5);
  const s = weekSummary({ entries }, rs, ingredients, products, items);
  assert.equal(s.meals, 1);
  close(s.consumed, 0.5);
});

// --- Test J / L ------------------------------------------------------------------
test('J/L — articles manuels, cases cochées et orphelins préservés lors du recalcul', () => {
  const rs = new Map([
    ['r1', { id: 'r1', servings: 2, items: [{ ingredientId: 'riz', qty: 200, unit: 'g' }, { ingredientId: 'oignon', qty: 1, unit: 'piece' }] }],
    ['r2', { id: 'r2', servings: 2, items: [{ ingredientId: 'leg', qty: 300, unit: 'g' }] }],
  ]);
  const opt = { weekId: 'W', ingredientsById: ingredients, newId };
  let { items } = reconcile([], applyStock(computeNeeds([{ recipeId: 'r1' }, { recipeId: 'r2' }], rs), new Map()), opt);
  // Ajout manuel sans quantité ni prix
  items.push({ id: 'pq', origin: 'manuel', name: 'Papier toilette', category: guessCategory('Papier toilette'), checked: false, price: null });
  assert.equal(items.at(-1).category, 'Entretien et hygiène');
  // On coche le riz et les légumes, on ajuste la quantité d'oignons
  items = items.map(i => i.key === 'riz|masse' || i.key === 'leg|masse' ? { ...i, checked: true } : i);
  items = items.map(i => i.key === 'oignon|piece' ? { ...i, qtyOverride: { qty: 2, unit: 'piece' } } : i);
  items = items.map(i => i.id === 'pq' ? { ...i, checked: true } : i);
  // On retire r2 du planning et on double r1
  const res = reconcile(items, applyStock(computeNeeds([{ recipeId: 'r1', servings: 4 }], rs), new Map()), opt);
  items = res.items;
  const pq = items.find(i => i.id === 'pq');
  assert.ok(pq && pq.checked, 'papier toilette conservé et coché');
  const riz = items.find(i => i.key === 'riz|masse');
  assert.equal(riz.checked, true, 'case cochée conservée');
  close(riz.toBuyBase, 400);
  close(riz.changedAfterCheck.fromBase, 200);
  const oignon = items.find(i => i.key === 'oignon|piece');
  assert.deepEqual(oignon.qtyOverride, { qty: 2, unit: 'piece' });
  const leg = items.find(i => i.key === 'leg|masse');
  assert.ok(leg, 'légumes cochés non supprimés silencieusement');
  assert.equal(leg.orphan, true);
  assert.equal(res.stats.orphaned, 1);
  // Un article auto jamais touché et devenu inutile est retiré
  const res2 = reconcile(items, applyStock(computeNeeds([], rs), new Map()), opt);
  assert.equal(res2.items.find(i => i.key === 'oignon|piece').orphan, true); // quantité modifiée → orphelin
  assert.ok(res2.items.find(i => i.id === 'pq'));
  // Repas remis au planning : l'orphelin redevient normal
  const res3 = reconcile(res2.items, applyStock(computeNeeds([{ recipeId: 'r2' }], rs), new Map()), opt);
  assert.equal(res3.items.find(i => i.key === 'leg|masse').orphan, false);
});

test('J bis — article auto supprimé manuellement : reste supprimé, restaurable', () => {
  const rs = new Map([['r', { id: 'r', servings: 1, items: [{ ingredientId: 'riz', qty: 100, unit: 'g' }] }]]);
  const opt = { weekId: 'W', ingredientsById: ingredients, newId };
  let { items } = reconcile([], applyStock(computeNeeds([{ recipeId: 'r' }], rs), new Map()), opt);
  items = items.map(i => ({ ...i, removed: true }));
  ({ items } = reconcile(items, applyStock(computeNeeds([{ recipeId: 'r', servings: 2 }], rs), new Map()), opt));
  assert.equal(items.length, 1);
  assert.equal(items[0].removed, true);
  assert.equal(isActive(items[0]), false);
  close(listBudget(items, ingredients, products).total, 0);
});

test('K — progression et montants cochés / restants', () => {
  const items = [
    { id: '1', origin: 'auto', ingredientId: 'riz500', dim: 'masse', toBuyBase: 200, checked: true },
    { id: '2', origin: 'auto', ingredientId: 'leg', dim: 'masse', toBuyBase: 500, checked: false },
    { id: '3', origin: 'manuel', name: 'Piles', price: 4.5, checked: false },
    { id: '4', origin: 'auto', ingredientId: 'riz', dim: 'masse', toBuyBase: 0, stockBase: 300, checked: false },
  ];
  assert.deepEqual(progress(items), { done: 1, total: 3 });
  const b = listBudget(items, ingredients, products);
  close(b.checked, 1.5);
  close(b.remaining, 1.5 + 4.5);
  close(b.meals, 3.0);
  close(b.extras, 4.5);
  close(b.stockValue, 0.75); // 300 g de riz à 2,50 €/kg déjà en stock
});

// --- Test M ----------------------------------------------------------------------
test('M — conversions d\'unités et cas non fiables', () => {
  close(convert(1, 'l', 'ml'), 1000);
  close(convert(25, 'cl', 'l'), 0.25);
  close(convert(1500, 'g', 'kg'), 1.5);
  assert.equal(convert(1, 'kg', 'l'), null, 'masse ↔ volume refusé');
  assert.equal(convert(1, 'cas', 'ml'), null, 'cuillère ↔ ml refusé');
  assert.equal(convert(1, 'piece', 'g'), null);
  assert.equal(compatible('g', 'kg'), true);
  assert.equal(compatible('pincee', 'g'), false);
  const s = sumQuantities([{ qty: 500, unit: 'g' }, { qty: 250, unit: 'g' }]);
  close(s[0].qty, 750);
  const v = sumQuantities([{ qty: 1, unit: 'l' }, { qty: 500, unit: 'ml' }]);
  close(v[0].qty, 1500);
  assert.equal(formatBase(1500, 'volume'), '1,5 l');
  assert.equal(formatBase(750, 'masse'), '750 g');
  const u = sumQuantities([{ qty: 2, unit: 'piece' }, { qty: 3, unit: 'piece' }]);
  close(u[0].qty, 5);
  const mix = sumQuantities([{ qty: 1, unit: 'kg' }, { qty: 1, unit: 'l' }]);
  assert.equal(mix.length, 2);
  assert.equal(normalizeUnit('Grammes'), 'g');
  assert.equal(normalizeUnit('c. à soupe'), 'cas');
  assert.equal(normalizeUnit('tasse'), null);
  assert.throws(() => toBase(1, 'tasse'));
  close(round2(0.475), 0.48);
  close(round2(1.005), 1.01);
  assert.equal(parseAmount('2,49 €'), 2.49);
  assert.equal(parseAmount(''), null);
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.equal(parseQty('1/2'), 0.5);
});

test('M bis — conversion pièce ↔ poids déclarée par l\'utilisateur (estimation signalée)', () => {
  const prods = new Map([['p-oignon', { id: 'p-oignon', name: 'Oignons 1 kg', packQty: 1, packUnit: 'kg', packPrice: 1.8, priceDate: fresh }]]);
  const ing = { id: 'o', name: 'Oignon', productIds: ['p-oignon'], unitWeight: { qty: 150, unit: 'g' } };
  const lc = lineCost(ing, 2, 'piece', prods);
  close(lc.cost, 0.54);
  assert.equal(lc.source.estimated, true);
  const p = purchaseFor(ing, 4, 'piece', prods); // 4 oignons ≈ 600 g → 1 filet de 1 kg
  close(p.payable, 1.8);
  assert.equal(p.estimated, true);
  // Sans correspondance déclarée : prix inconnu, pas d'invention
  assert.equal(lineCost({ ...ing, unitWeight: null }, 2, 'piece', prods).cost, null);
});

// --- Stock ------------------------------------------------------------------------
test('Stock — déduction après repas, annulation, pas de double déduction possible côté calcul', () => {
  const rs = new Map([['r', recipeA]]);
  const stock = [
    { id: 's1', ingredientId: 'riz', qty: 0.15, unit: 'kg', expiry: '2026-12-01' },
    { id: 's2', ingredientId: 'riz', qty: 100, unit: 'g', expiry: '2026-11-01' },
  ];
  const d = deductionForEntry({ recipeId: 'r', servings: 2 }, rs, stock);
  // 200 g pris : d'abord s2 (péremption la plus proche) 100 g, puis 100 g de s1
  const s1 = d.updates.find(s => s.id === 's1'), s2 = d.updates.find(s => s.id === 's2');
  close(s2.qty, 0); close(s1.qty, 0.05);
  assert.equal(d.missing.length, 1); // légumes absents du stock
  close(d.missing[0].qtyBase, 150);
  // La semaine du repas réintègre ses propres mouvements : ses besoins ne gonflent pas
  const after = stock.map(s => d.updates.find(u => u.id === s.id) || s);
  const needs = applyStock(computeNeeds([{ recipeId: 'r', servings: 2 }], rs), stockByKey(after, d.movements));
  close(needs.get('riz|masse').toBuyBase, 0);
  // Annulation
  const back = undoMovements(d.movements, after);
  close(back.find(s => s.id === 's1').qty, 0.15);
  close(back.find(s => s.id === 's2').qty, 100);
});

// --- Semaines --------------------------------------------------------------------
test('Semaines ISO : numéros, lundi, navigation, changement d\'année', () => {
  assert.equal(isoWeekId(new Date(2026, 9, 27)), '2026-W44');
  assert.equal(isoWeekId(new Date(2027, 0, 1)), '2026-W53');
  assert.equal(isoWeekId(new Date(2026, 0, 1)), '2026-W01');
  const mon = weekStart('2026-W44');
  assert.equal(mon.getDay(), 1); assert.equal(mon.getDate(), 26);
  assert.equal(addWeeks('2026-W53', 1), '2027-W01');
  assert.equal(addWeeks('2027-W01', -1), '2026-W53');
});

// --- Import / export ----------------------------------------------------------------
test('Import CSV de recettes : validation, regroupement, erreurs explicites', () => {
  const csv = [
    'recette;portions;preparation_min;cuisson_min;categorie;ingredient;quantite;unite;facultatif;rayon;etapes',
    'Pâtes pesto;2;5;10;Pâtes;Pâtes;200;g;;Épicerie sèche;Cuire les pâtes | Ajouter le pesto',
    'Pâtes pesto;2;5;10;Pâtes;Pesto;"0,5";kg;non;Conserves;',
    'Pâtes pesto;2;5;10;Pâtes;Parmesan;30;g;oui;Produits laitiers;',
    'Soupe ratée;0;5;10;Soupe;Eau;1;tasse;;;',
  ].join('\n');
  const r = parseRecipesCSV(csv);
  assert.equal(r.total, 2);
  assert.equal(r.recipes.length, 1);
  const p = r.recipes[0];
  assert.equal(p.ingredients.length, 3);
  assert.equal(p.ingredients[1].qty, 0.5);
  assert.equal(p.ingredients[2].optional, true);
  assert.deepEqual(p.steps, ['Cuire les pâtes', 'Ajouter le pesto']);
  assert.ok(r.errors.some(e => /portions invalides/.test(e)));
  assert.ok(r.errors.some(e => /unité inconnue/.test(e)));
});

test('Import JSON de recettes et catalogue de produits CSV', () => {
  const j = parseRecipesJSON(JSON.stringify({ recipes: [{ name: 'Omelette', servings: 1, category: 'Végétarien', ingredients: [{ name: 'Œufs', qty: 3, unit: 'piece' }] }, { name: '', servings: 1 }] }));
  assert.equal(j.recipes.length, 1);
  assert.equal(j.errors.length, 1);
  assert.equal(parseRecipesJSON('{oops').errors.length, 1);
  const csv = 'nom,marque,enseigne,code_barres,rayon,contenance,unite,prix,date_prix,vrac\n' +
    'Riz basmati,Boni,Colruyt,5400141000000,Épicerie sèche,1,kg,"2,99",2026-10-20,\n' +
    'Bananes,,Colruyt,,Fruits et légumes,1,kg,1.79,,oui\n' +
    'Mystère,,,,,abc,g,1,,\n';
  const p = parseProductsCSV(csv);
  assert.equal(p.products.length, 2);
  assert.equal(p.products[0].packPrice, 2.99);
  assert.equal(p.products[1].soldByWeight, true);
  assert.equal(p.errors.length, 1);
});

test('CSV : guillemets, retours à la ligne, aller-retour', () => {
  const out = toCSV([['a', 'b;c', 'd"e'], ['1', 'x\ny', '']]);
  const back = parseCSV(out);
  assert.deepEqual(back, [['a', 'b;c', 'd"e'], ['1', 'x\ny', '']]);
});

test('Sauvegarde : refuse les fichiers étrangers ou incohérents', () => {
  assert.ok(validateBackup({}).length > 0);
  assert.ok(validateBackup({ app: 'popote', schemaVersion: 1, data: { ingredients: [], recipes: [{ id: 'r', name: 'X', items: [{ ingredientId: 'nope' }] }] } }).length > 0);
  assert.deepEqual(validateBackup({ app: 'popote', schemaVersion: 1, data: { ingredients: [{ id: 'i' }], recipes: [{ id: 'r', name: 'X', items: [{ ingredientId: 'i' }] }] } }), []);
});

test('Liste : prix d\'un article manuel inclus seulement s\'il est renseigné', () => {
  const it = { origin: 'manuel', name: 'Lessive', price: 6.5 };
  assert.equal(priceItem(it).payable, 6.5);
  assert.equal(priceItem({ ...it, price: null }).payable, null);
});
