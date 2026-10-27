import { html, icon, openSheet, $, toast, confirmSheet } from '../dom.js';
import { state, saveStockItem, deleteStockItem, createIngredient, findIngredientByName, sortedIngredients, updateSettings, productsForIngredient, syncList, isPastWeek } from '../../store.js';
import { formatQty, normalizeUnit } from '../../core/units.js';
import { parseQty } from '../../core/money.js';
import { expiryState } from '../../core/stock.js';
import { CATEGORIES } from '../../core/shopping.js';
import { unitOptions, dateFR, empty } from '../common.js';

export function renderStock() {
  const items = [...state.stock.values()].sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999') || nameOf(a).localeCompare(nameOf(b), 'fr'));
  const on = state.settings.stockEnabled;
  const byCat = new Map();
  for (const s of items) {
    const ing = state.ingredients.get(s.ingredientId);
    const cat = (ing && ing.category) || 'Autres';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  return html`
    <header class="page-head page-head-back">
      <a class="icon-btn" href="#/" aria-label="Retour">${icon('chev-left')}</a>
      <h1>Stock</h1>
      <div class="head-actions"><button type="button" class="icon-btn icon-btn-primary" data-action="stock-new" aria-label="Ajouter au stock">${icon('plus')}</button></div>
    </header>
    <label class="switch switch-card"><input type="checkbox" data-change="stock-enabled" ${on ? 'checked' : ''}>
      <span><strong>Déduire le stock de la liste de courses</strong><br><small>Désactivez pour obtenir la liste de tous les ingrédients nécessaires.</small></span></label>
    ${items.length ? CATEGORIES.filter(c => byCat.has(c)).map(cat => html`
      <section class="block"><h2 class="sec-title">${cat}</h2>
      <ul class="stock-list">${byCat.get(cat).map(s => {
        const ex = expiryState(s);
        return html`<li><button type="button" class="srow" data-action="stock-edit" data-id="${s.id}">
          <span><strong>${nameOf(s)}</strong>${s.demo ? html` <small>(exemple)</small>` : ''}
            ${s.expiry ? html`<small class="exp exp-${ex}">${ex === 'perime' ? 'Périmé le ' : 'À consommer avant le '}${dateFR(s.expiry)}</small>` : ''}</span>
          <span class="srow-qty">${s.qty > 0 ? formatQty(s.qty, s.unit) : html`<span class="tag tag-warn">épuisé</span>`}</span>
        </button></li>`;
      })}</ul></section>`)
    : empty('box', 'Placard vide', 'Indiquez ce que vous avez déjà (riz, pâtes, épices…) : la liste de courses n\'affichera que ce qui manque.',
      html`<button type="button" class="btn btn-primary" data-action="stock-new">Ajouter un produit en stock</button>`)}
    <p class="hint">Après un repas, ouvrez-le dans le planning et choisissez « Cuisiné : déduire du stock ». La déduction ne se fait qu'une fois et peut être annulée.</p>`;
}

const nameOf = (s) => (state.ingredients.get(s.ingredientId) || {}).name || s.name || '?';

export async function handleStock(action, el) {
  if (action === 'stock-new') openStockForm(null);
  else if (action === 'stock-edit') openStockForm(el.dataset.id);
  else return false;
  return true;
}

export async function handleStockChange(kind, el) {
  if (kind !== 'stock-enabled') return false;
  await updateSettings({ stockEnabled: el.checked });
  for (const w of [...state.weeks.values()]) if (!isPastWeek(w.id)) await syncList(w.id);
  toast(el.checked ? 'Le stock est déduit des courses' : 'Le stock n\'est plus déduit des courses');
  return true;
}

function openStockForm(id) {
  const src = id ? state.stock.get(id) : null;
  const ing = src ? state.ingredients.get(src.ingredientId) : null;
  const s = openSheet(() => html`
    <form class="form">
      <header class="sheet-head">
        <button type="button" class="btn btn-quiet" data-close>Annuler</button>
        <h2>${src ? 'Produit en stock' : 'Ajouter au stock'}</h2>
        <button type="submit" class="btn btn-primary btn-small">Enregistrer</button>
      </header>
      <label class="field"><span>Ingrédient</span><input name="name" list="stock-ing-dl" value="${ing ? ing.name : (src && src.name) || ''}" required autocomplete="off" placeholder="ex. Riz"></label>
      <datalist id="stock-ing-dl">${sortedIngredients().map(i => html`<option value="${i.name}">`)}</datalist>
      <p class="hint">Utilisez le même nom que dans vos recettes pour que le stock soit déduit.</p>
      <div class="row2">
        <label class="field"><span>Quantité disponible</span><input name="qty" inputmode="decimal" value="${src ? String(src.qty).replace('.', ',') : ''}" required></label>
        <label class="field"><span>Unité</span><select name="unit">${unitOptions(src ? src.unit : (ing && ing.defaultUnit) || 'g')}</select></label>
      </div>
      <label class="field"><span>Date de péremption <em>facultatif</em></span><input name="expiry" type="date" value="${src && src.expiry || ''}"></label>
      <label class="field"><span>Produit de supermarché <em>facultatif</em></span><select name="productId"><option value="">—</option>
        ${(ing ? productsForIngredient(ing.id) : []).map(p => html`<option value="${p.id}" ${src && src.productId === p.id ? 'selected' : ''}>${p.name} (${p.store})</option>`)}</select></label>
      ${src ? html`<button type="button" class="btn btn-danger btn-block" data-s="del">Retirer du stock</button>` : ''}
    </form>`, { full: true, label: 'Stock' });
  s.el.addEventListener('change', (e) => {
    if (e.target.name === 'name') {
      const i = findIngredientByName(e.target.value);
      if (i && i.defaultUnit && !src) s.el.querySelector('[name="unit"]').value = i.defaultUnit;
    }
  });
  s.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-s="del"]')) {
      if (await confirmSheet({ title: 'Retirer du stock ?', ok: 'Retirer', danger: true })) { await deleteStockItem(id); s.close(); }
    }
  });
  $('form', s.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const name = f.name.value.trim();
    const qty = parseQty(f.qty.value);
    const unit = normalizeUnit(f.unit.value);
    if (!name || !(qty >= 0) || qty === null) { toast('Indiquez un nom et une quantité.', { tone: 'warn' }); return; }
    const i = await createIngredient({ name, defaultUnit: unit });
    await saveStockItem({ ...(src || {}), ingredientId: i.id, name: i.name, qty, unit, expiry: f.expiry.value || null, productId: f.productId.value || null, demo: false });
    toast('Stock enregistré');
    s.close();
  });
}
