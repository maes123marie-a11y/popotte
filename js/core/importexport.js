// Import / export : analyse CSV, validation des recettes et des catalogues de prix.
import { normalizeUnit } from './units.js';
import { CATEGORIES, RECIPE_CATEGORIES } from './shopping.js';
import { parseAmount, parseQty } from './money.js';

export const SCHEMA_VERSION = 1;

// --- CSV --------------------------------------------------------------------
export function detectDelimiter(text) {
  const first = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ';';
}

export function parseCSV(text, delimiter) {
  text = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

const norm = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  return rows.slice(1).map((r, i) => {
    const o = { __line: i + 2 };
    head.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
    return o;
  });
}

export function toCSV(rows, delimiter = ';') {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map(r => r.map(esc).join(delimiter)).join('\r\n');
}

const truthy = (v) => /^(1|oui|true|vrai|x|yes)$/i.test(String(v || '').trim());

function matchCategory(v, list, fallback) {
  const n = norm(v);
  if (!n) return fallback;
  return list.find(c => norm(c) === n) || list.find(c => norm(c).startsWith(n)) || null;
}

// --- Recettes ----------------------------------------------------------------
// Forme d'échange d'une recette (indépendante des identifiants internes) :
// { name, description, servings, prepMin, cookMin, category, notes, steps:[],
//   ingredients:[{ name, qty, unit, optional, category }] }

export function validateRecipeDraft(r, where = '') {
  const errors = [];
  const out = {
    name: String(r.name || '').trim(),
    description: String(r.description || '').trim(),
    servings: Number(r.servings),
    prepMin: r.prepMin === '' || r.prepMin == null ? 0 : Number(r.prepMin),
    cookMin: r.cookMin === '' || r.cookMin == null ? 0 : Number(r.cookMin),
    category: matchCategory(r.category, RECIPE_CATEGORIES, 'Autre'),
    notes: String(r.notes || '').trim(),
    steps: (Array.isArray(r.steps) ? r.steps : String(r.steps || '').split(/\s*\|\s*|\n/)).map(s => String(s).trim()).filter(Boolean),
    ingredients: [],
  };
  if (!out.name) errors.push(`${where}nom de recette manquant`);
  if (!(out.servings > 0 && out.servings <= 100)) errors.push(`${where}portions invalides (${r.servings ?? 'vide'})`);
  if (!(out.prepMin >= 0) || !(out.cookMin >= 0)) errors.push(`${where}temps invalide`);
  if (!out.category) { errors.push(`${where}catégorie inconnue « ${r.category} »`); out.category = 'Autre'; }
  (r.ingredients || []).forEach((ing, i) => {
    const w = `${where}ingrédient ${i + 1} : `;
    const name = String(ing.name || '').trim();
    const qty = typeof ing.qty === 'number' ? ing.qty : parseQty(ing.qty);
    const unit = normalizeUnit(ing.unit);
    if (!name) errors.push(`${w}nom manquant`);
    if (!(qty > 0)) errors.push(`${w}quantité invalide (${ing.qty ?? 'vide'})`);
    if (!unit) errors.push(`${w}unité inconnue (${ing.unit ?? 'vide'})`);
    const cat = matchCategory(ing.category, CATEGORIES, 'Autres') || 'Autres';
    out.ingredients.push({ name, qty, unit, optional: !!(ing.optional === true || truthy(ing.optional)), category: cat });
  });
  return { recipe: out, errors };
}

// CSV recettes : une ligne par ingrédient.
// Colonnes : recette; portions; preparation_min; cuisson_min; categorie;
//            ingredient; quantite; unite; facultatif; rayon; etapes; description; notes
export function parseRecipesCSV(text) {
  const objs = rowsToObjects(parseCSV(text));
  const groups = new Map();
  const errors = [];
  for (const o of objs) {
    const name = o.recette || o.nom || o.name;
    if (!name) { errors.push(`ligne ${o.__line} : colonne « recette » vide`); continue; }
    let g = groups.get(name);
    if (!g) {
      g = { name, servings: o.portions, prepMin: o.preparation_min ?? o.preparation, cookMin: o.cuisson_min ?? o.cuisson,
        category: o.categorie, steps: o.etapes || '', description: o.description || '', notes: o.notes || '', ingredients: [], line: o.__line };
      groups.set(name, g);
    } else if (o.etapes && !g.steps) g.steps = o.etapes;
    if (o.ingredient) g.ingredients.push({ name: o.ingredient, qty: o.quantite, unit: o.unite, optional: o.facultatif, category: o.rayon });
  }
  const valid = [];
  for (const g of groups.values()) {
    const v = validateRecipeDraft(g, `« ${g.name} » (ligne ${g.line}) : `);
    if (v.errors.length) errors.push(...v.errors); else valid.push(v.recipe);
  }
  return { recipes: valid, errors, total: groups.size };
}

export function parseRecipesJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { recipes: [], errors: ['JSON invalide : ' + e.message], total: 0 }; }
  const arr = Array.isArray(data) ? data : Array.isArray(data.recipes) ? data.recipes : null;
  if (!arr) return { recipes: [], errors: ['Le fichier doit contenir un tableau « recipes ».'], total: 0 };
  const valid = [], errors = [];
  arr.forEach((r, i) => {
    const v = validateRecipeDraft(r, `recette ${i + 1} « ${r && r.name || '?'} » : `);
    if (v.errors.length) errors.push(...v.errors); else valid.push(v.recipe);
  });
  return { recipes: valid, errors, total: arr.length };
}

// --- Catalogue de produits -----------------------------------------------------
// Colonnes : nom; marque; enseigne; code_barres; rayon; contenance; unite; prix;
//            date_prix (AAAA-MM-JJ); source; url; vrac; zone; ingredient
export function parseProductsCSV(text) {
  const objs = rowsToObjects(parseCSV(text));
  const products = [], errors = [];
  for (const o of objs) {
    const w = `ligne ${o.__line} : `;
    const name = o.nom || o.name;
    const packQty = parseQty(o.contenance);
    const packUnit = normalizeUnit(o.unite);
    const price = parseAmount(o.prix);
    const e = [];
    if (!name) e.push('nom manquant');
    if (!(packQty > 0)) e.push(`contenance invalide (${o.contenance || 'vide'})`);
    if (!packUnit) e.push(`unité inconnue (${o.unite || 'vide'})`);
    if (Number.isNaN(price)) e.push(`prix invalide (${o.prix})`);
    let priceDate = null;
    if (o.date_prix) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(o.date_prix) && isFinite(Date.parse(o.date_prix))) priceDate = new Date(o.date_prix + 'T12:00:00').toISOString();
      else e.push(`date invalide (${o.date_prix}), format attendu AAAA-MM-JJ`);
    }
    const barcode = (o.code_barres || o.ean || '').replace(/\D/g, '');
    if (barcode && !(barcode.length >= 8 && barcode.length <= 14)) e.push(`code-barres invalide (${o.code_barres})`);
    if (e.length) { errors.push(w + e.join(', ')); continue; }
    products.push({
      name, brand: o.marque || '', store: o.enseigne || '', barcode: barcode || '',
      category: matchCategory(o.rayon, CATEGORIES, 'Autres') || 'Autres',
      packQty, packUnit, packPrice: price, soldByWeight: truthy(o.vrac),
      priceDate, priceSource: price == null ? null : (o.source || 'import'),
      url: o.url || '', zone: o.zone || '', ingredientName: o.ingredient || '',
    });
  }
  return { products, errors, total: objs.length };
}

// --- Sauvegarde complète ---------------------------------------------------------
export function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return ['Fichier vide ou illisible.'];
  if (obj.app !== 'popote') errors.push('Ce fichier n\'est pas une sauvegarde Popote.');
  if (!(obj.schemaVersion >= 1)) errors.push('Version de sauvegarde inconnue.');
  if (obj.schemaVersion > SCHEMA_VERSION) errors.push('Sauvegarde créée par une version plus récente de l\'application.');
  const d = obj.data || {};
  for (const k of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping']) {
    if (d[k] != null && !Array.isArray(d[k])) errors.push(`Section « ${k} » invalide.`);
  }
  if (!errors.length) {
    const ids = new Set((d.ingredients || []).map(i => i.id));
    for (const r of d.recipes || []) {
      if (!r.id || !r.name) { errors.push('Recette sans identifiant ou sans nom.'); break; }
      for (const it of r.items || []) {
        if (!ids.has(it.ingredientId)) { errors.push(`Recette « ${r.name} » : ingrédient référencé introuvable.`); break; }
      }
    }
  }
  return errors;
}
