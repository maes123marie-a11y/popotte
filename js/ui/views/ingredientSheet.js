import { html, icon, openSheet, $, toast, confirmSheet } from '../dom.js';
import { state, saveIngredient, linkProduct, setPreferredProduct, deleteIngredient, productsForIngredient } from '../../store.js';
import { normalizeUnit, formatQty } from '../../core/units.js';
import { parseAmount, parseQty } from '../../core/money.js';
import { lineCost } from '../../core/costing.js';
import { unitOptions, categoryOptions, formatEUR, statusTag, refPriceLabel, dateFR } from '../common.js';
import { openProductForm } from './products.js';

export function openIngredientSheet(id, { onClose, contextQty } = {}) {
  const ing0 = state.ingredients.get(id);
  if (!ing0) { toast('Ingrédient introuvable.'); return; }
  let pickMode = false, q = '';

  const sheet = openSheet(() => {
    const ing = state.ingredients.get(id);
    if (!ing) return html`<p>Ingrédient supprimé.</p>`;
    const prods = productsForIngredient(id);
    const mp = ing.manualPrice || {};
    const uw = ing.unitWeight || {};
    const ctx = contextQty ? lineCost(ing, contextQty.qty, contextQty.unit, state.products) : null;
    const others = [...state.products.values()].filter(p => !(ing.productIds || []).includes(p.id))
      .filter(p => !q || `${p.name} ${p.brand} ${p.store}`.toLocaleLowerCase('fr').includes(q.toLocaleLowerCase('fr')))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, 30);
    return html`
      <header class="sheet-head">
        <button type="button" class="btn btn-quiet" data-close>Fermer</button>
        <h2>${ing.name}</h2>
        <span></span>
      </header>
      ${ctx ? html`<p class="hint">Pour ${formatQty(contextQty.qty, contextQty.unit)} : ${ctx.cost != null ? html`<strong>${formatEUR(ctx.cost)}</strong>` : 'prix inconnu'}</p>` : ''}
      <form class="form" data-form="ing">
        <label class="field"><span>Nom</span><input name="name" value="${ing.name}" required></label>
        <div class="row2">
          <label class="field"><span>Rayon</span><select name="category">${categoryOptions(ing.category)}</select></label>
          <label class="field"><span>Unité habituelle</span><select name="defaultUnit">${unitOptions(ing.defaultUnit || 'g')}</select></label>
        </div>

        <h3 class="form-sec">Produits de supermarché</h3>
        ${prods.length ? html`<ul class="prod-mini">${prods.map(p => html`<li>
            <label class="radio"><input type="radio" name="pref" value="${p.id}" ${ing.preferredProductId === p.id ? 'checked' : ''}>
              <span><strong>${p.name}</strong> ${p.brand ? html`<small>${p.brand}</small>` : ''}<br>
              <small>${p.store || 'Enseigne ?'} · ${formatQty(p.packQty, p.packUnit)} · ${p.packPrice != null ? formatEUR(p.packPrice) : 'prix ?'} ${refPriceLabel(p) ? `(${refPriceLabel(p)})` : ''}</small>
              ${statusTag(p)}</span></label>
            <button type="button" class="icon-btn" data-a="edit-prod" data-id="${p.id}" aria-label="Modifier le produit">${icon('pencil')}</button>
            <button type="button" class="icon-btn" data-a="unlink" data-id="${p.id}" aria-label="Dissocier">${icon('x')}</button>
          </li>`)}
          <li><label class="radio"><input type="radio" name="pref" value="" ${!ing.preferredProductId ? 'checked' : ''}><span>Pas de préférence : le moins cher au prix unitaire, combinaison de formats optimisée</span></label></li>
          </ul>` : html`<p class="hint">Aucun produit associé. Associez un produit pour obtenir un prix et calculer les conditionnements à acheter.</p>`}
        <div class="btn-row">
          <button type="button" class="btn btn-small" data-a="new-prod">${icon('plus')} Nouveau produit</button>
          <button type="button" class="btn btn-small" data-a="pick">${icon('link')} Produit existant</button>
        </div>
        ${pickMode ? html`<div class="picker">
          <input type="search" placeholder="Rechercher un produit" value="${q}" data-a="q" autocomplete="off">
          <ul>${others.map(p => html`<li><button type="button" data-a="link" data-id="${p.id}">${p.name} <small>${p.store} · ${formatQty(p.packQty, p.packUnit)}</small></button></li>`)}</ul>
          ${!others.length ? html`<p class="hint">Aucun produit. Créez-en un.</p>` : ''}
        </div>` : ''}

        <h3 class="form-sec">Prix manuel <small>utilisé si aucun produit n'a de prix</small></h3>
        <div class="row3">
          <label class="field"><span>Prix (€)</span><input name="mpPrice" inputmode="decimal" value="${mp.price != null ? String(mp.price).replace('.', ',') : ''}" placeholder="ex. 2,49"></label>
          <label class="field"><span>pour</span><input name="mpQty" inputmode="decimal" value="${mp.qty ?? 1}"></label>
          <label class="field"><span>unité</span><select name="mpUnit">${unitOptions(mp.unit || ing.defaultUnit || 'kg')}</select></label>
        </div>

        <h3 class="form-sec">Correspondance pièce ↔ poids <small>facultatif</small></h3>
        <p class="hint">Exemple : 1 oignon ≈ 150 g. Permet de chiffrer « 2 oignons » avec un filet vendu au kilo. Le résultat est signalé comme estimé.</p>
        <div class="row2">
          <label class="field"><span>1 pièce ≈</span><input name="uwQty" inputmode="decimal" value="${uw.qty ?? ''}" placeholder="—"></label>
          <label class="field"><span>unité</span><select name="uwUnit">${unitOptions(uw.unit || 'g')}</select></label>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Enregistrer</button>
        <button type="button" class="btn btn-quiet btn-block danger-text" data-a="delete">Supprimer cet ingrédient</button>
        <p class="hint">Créé le ${dateFR(ing.createdAt)}</p>
      </form>`;
  }, { full: true, label: 'Ingrédient', onClose });

  const root = sheet.el;
  const rerender = () => { sheet.render(); };

  root.addEventListener('input', (e) => {
    if (e.target.dataset.a === 'q') {
      q = e.target.value;
      const pos = e.target.selectionStart;
      rerender();
      const i = $('[data-a="q"]', root); i.focus(); i.setSelectionRange(pos, pos);
    }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.name === 'pref') await setPreferredProduct(id, e.target.value || null);
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.a;
    if (a === 'pick') { pickMode = !pickMode; rerender(); }
    else if (a === 'link') { await linkProduct(id, b.dataset.id); pickMode = false; rerender(); toast('Produit associé'); }
    else if (a === 'unlink') { await linkProduct(id, b.dataset.id, { unlink: true }); rerender(); }
    else if (a === 'new-prod') openProductForm(null, { linkIngredientId: id, defaults: { name: state.ingredients.get(id).name, category: state.ingredients.get(id).category, packUnit: state.ingredients.get(id).defaultUnit }, onClose: rerender });
    else if (a === 'edit-prod') openProductForm(b.dataset.id, { onClose: rerender });
    else if (a === 'delete') {
      if (!(await confirmSheet({ title: 'Supprimer cet ingrédient ?', message: 'Ses associations à des produits seront perdues.', ok: 'Supprimer', danger: true }))) return;
      try { await deleteIngredient(id); sheet.close(); toast('Ingrédient supprimé'); }
      catch (err) { toast(err.message, { tone: 'warn', ms: 5000 }); }
    }
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name')).trim();
    if (!name) { toast('Le nom est obligatoire.'); return; }
    const price = parseAmount(f.get('mpPrice'));
    if (Number.isNaN(price)) { toast('Prix manuel invalide.'); return; }
    const mq = parseQty(f.get('mpQty'));
    const uq = parseQty(f.get('uwQty'));
    const ing = state.ingredients.get(id);
    await saveIngredient({
      ...ing, name, category: f.get('category'), defaultUnit: normalizeUnit(f.get('defaultUnit')),
      manualPrice: price == null ? null : { price, qty: mq > 0 ? mq : 1, unit: normalizeUnit(f.get('mpUnit')), date: new Date().toISOString() },
      unitWeight: uq > 0 ? { qty: uq, unit: normalizeUnit(f.get('uwUnit')) } : null,
    });
    toast('Ingrédient enregistré');
    sheet.close();
  });
  return sheet;
}
