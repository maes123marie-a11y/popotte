import { html, icon, openSheet, $, toast, confirmSheet, saveFile } from '../dom.js';
import {
  state, weekItems, getWeek, addManualItem, updateItem, toggleItem, setChecked, resetChecks, duplicateItem,
  removeItem, restoreItem, resolveOrphan, ackChange, syncList, setUI, isPastWeek,
} from '../../store.js';
import { CATEGORIES, listBudget, priceItem, itemQtyBase, isActive, progress, guessCategory } from '../../core/shopping.js';
import { formatBase, formatQty, normalizeUnit, toBase } from '../../core/units.js';
import { parseAmount, parseQty } from '../../core/money.js';
import { describePacks } from '../../core/costing.js';
import { selectedWeek, weekNav, formatEUR, empty, unitOptions, categoryOptions, pluralize } from '../common.js';
import { openIngredientSheet } from './ingredientSheet.js';

const ui = () => ({
  show: state.ui.shopShow || 'restants', hideDone: !!state.ui.hideDone,
  collapsed: new Set(state.ui.collapsed || []), addOpen: !!state.ui.addOpen,
});

export function renderShopping() {
  const wid = selectedWeek();
  const all = weekItems(wid);
  const u = ui();
  const b = listBudget(all, state.ingredients, state.products);
  const pr = progress(all);
  const active = all.filter(isActive);
  const orphans = active.filter(i => i.orphan);
  const inStock = all.filter(i => i.origin === 'auto' && !i.removed && !isActive(i));
  const removed = all.filter(i => i.removed);
  const pct = pr.total ? Math.round(pr.done / pr.total * 100) : 0;
  const week = getWeek(wid);

  const groups = CATEGORIES.map(cat => {
    const items = active.filter(i => (i.category || 'Autres') === cat);
    return { cat, items, done: items.filter(i => i.checked).length };
  }).filter(g => g.items.length);
  // Catégorie inconnue (ancienne donnée) → Autres
  const unknownCat = active.filter(i => !CATEGORIES.includes(i.category));
  if (unknownCat.length) {
    const g = groups.find(x => x.cat === 'Autres');
    if (g) g.items.push(...unknownCat); else groups.push({ cat: 'Autres', items: unknownCat, done: unknownCat.filter(i => i.checked).length });
  }

  return html`
    <header class="page-head"><h1>Courses</h1>
      <div class="head-actions"><button type="button" class="icon-btn" data-action="shop-menu" aria-label="Actions sur la liste">${icon('more')}</button></div>
    </header>
    ${weekNav(wid, { compact: true })}
    ${isPastWeek(wid) ? html`<p class="banner">Liste d'une semaine passée. Elle n'est plus recalculée automatiquement.</p>` : ''}

    <div class="progress" role="status" aria-live="polite">
      <div class="progress-text"><strong>${pr.done} article${pr.done > 1 ? 's' : ''} sur ${pr.total} acheté${pr.done > 1 ? 's' : ''}</strong>
        <span>${b.remaining || b.checked ? `${formatEUR(b.remaining)} restant` : ''}</span></div>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
    </div>

    <form class="quick-add" data-form="quick-add" autocomplete="off">
      <input name="name" placeholder="Ex. lessive" aria-label="Nom de l'article" data-keep="qa-name" enterkeyhint="done">
      <button type="submit" class="btn btn-primary">${icon('plus')} Ajouter un article</button>
      <button type="button" class="link qa-more" data-action="qa-toggle" aria-expanded="${u.addOpen}">${u.addOpen ? 'Moins d\'options' : 'Quantité, prix, rayon…'}</button>
      ${u.addOpen ? html`<div class="qa-details">
        <input name="qty" inputmode="decimal" placeholder="Qté" aria-label="Quantité">
        <select name="unit" aria-label="Unité">${unitOptions('', { allowEmpty: true })}</select>
        <input name="price" inputmode="decimal" placeholder="Prix €" aria-label="Prix estimé">
        <select name="category" aria-label="Rayon"><option value="">Rayon auto</option>${categoryOptions('')}</select>
        <input name="note" placeholder="Note" aria-label="Note" class="qa-note">
      </div>` : ''}
    </form>

    ${all.length ? html`
    <div class="shop-filters">
      <div class="seg" role="tablist">
        <button type="button" role="tab" class="${u.show === 'restants' ? 'on' : ''}" data-action="shop-show" data-v="restants" aria-selected="${u.show === 'restants'}">À acheter</button>
        <button type="button" role="tab" class="${u.show === 'tous' ? 'on' : ''}" data-action="shop-show" data-v="tous" aria-selected="${u.show === 'tous'}">Tout afficher</button>
      </div>
      <label class="switch"><input type="checkbox" data-change="hide-done" ${u.hideDone ? 'checked' : ''}><span>Masquer les rayons terminés</span></label>
    </div>` : ''}

    ${orphans.length ? html`<section class="orphans">
      <p>${icon('alert')} ${pluralize(orphans.length, 'article ne correspond', 'articles ne correspondent')} plus à aucun repas planifié. Gardez-les ou supprimez-les :</p>
      <ul>${orphans.map(o => html`<li><span>${o.name}${o.checked ? ' (coché)' : ''}</span>
        <button type="button" class="btn btn-small" data-action="orphan-keep" data-id="${o.id}">Garder</button>
        <button type="button" class="btn btn-small btn-danger" data-action="orphan-drop" data-id="${o.id}">Supprimer</button></li>`)}</ul>
    </section>` : ''}

    ${!active.length && !inStock.length ? (week.entries.length
      ? empty('cart', 'Liste vide', 'Tout est couvert par votre stock ou retiré. Ajoutez un article ci-dessus si besoin.')
      : empty('cart', 'Aucun article', 'Planifiez des repas pour générer la liste, ou ajoutez librement des articles ci-dessus.',
        html`<a class="btn btn-primary" href="#/planning">Planifier la semaine</a>`)) : ''}

    ${groups.map(g => {
      const allDone = g.done === g.items.length;
      if (allDone && u.hideDone) return '';
      const visible = u.show === 'tous' ? g.items : g.items.filter(i => !i.checked);
      const collapsed = u.collapsed.has(g.cat);
      const sorted = [...visible].sort((a, b) => (a.checked - b.checked) || a.name.localeCompare(b.name, 'fr'));
      return html`<section class="aisle ${allDone ? 'done' : ''}">
        <button type="button" class="aisle-head" data-action="aisle-toggle" data-cat="${g.cat}" aria-expanded="${!collapsed}">
          ${icon(collapsed ? 'chev-right' : 'chev-down')}<h2>${g.cat}</h2><span class="aisle-count">${g.done}/${g.items.length}</span>
        </button>
        ${!collapsed ? html`<ul class="items">${sorted.map(i => itemRow(i))}
          ${!sorted.length ? html`<li class="aisle-empty">Tout est dans le panier.</li>` : ''}</ul>` : ''}
      </section>`;
    })}

    ${inStock.length ? html`<details class="aisle aisle-extra"><summary>Déjà en stock (${inStock.length})</summary>
      <ul class="items">${inStock.map(i => html`<li class="item stock-row"><span>${i.name}</span><span>${formatBase(i.stockBase, i.dim)} en stock</span></li>`)}</ul>
      <p class="hint">Ces besoins sont couverts par votre placard : rien à acheter.</p></details>` : ''}
    ${removed.length ? html`<details class="aisle aisle-extra"><summary>Retirés de la liste (${removed.length})</summary>
      <ul class="items">${removed.map(i => html`<li class="item stock-row"><span>${i.name}</span><button type="button" class="btn btn-small" data-action="item-restore" data-id="${i.id}">Remettre</button></li>`)}</ul></details>` : ''}

    ${b.count ? receipt(b) : ''}
  `;
}

function itemRow(i) {
  const p = priceItem(i, state.ingredients, state.products);
  const q = itemQtyBase(i);
  const qtyTxt = q.qty != null && q.qty > 0 ? formatBase(q.qty, q.dim) : '';
  const packs = p.packs && p.packs.length ? describePacks(p.packs, state.products) : '';
  const overridden = i.origin === 'auto' && i.qtyOverride;
  return html`<li class="item ${i.checked ? 'checked' : ''} ${i.orphan ? 'orphan' : ''}">
    <button type="button" class="tick" role="checkbox" aria-checked="${i.checked}" data-action="item-toggle" data-id="${i.id}" aria-label="${i.checked ? 'Décocher' : 'Cocher'} ${i.name}">
      <span class="box">${i.checked ? icon('check') : ''}</span>
    </button>
    <button type="button" class="item-body" data-action="item-edit" data-id="${i.id}">
      <span class="item-line"><span class="item-name">${i.name}</span>${qtyTxt ? html`<span class="item-qty">${qtyTxt}</span>` : ''}</span>
      <span class="item-sub">
        ${i.origin === 'manuel' ? html`<span class="tag tag-manual">ajout</span>` : ''}
        ${i.optional ? html`<span class="tag">facultatif</span>` : ''}
        ${overridden ? html`<span class="tag">qté modifiée</span>` : ''}
        ${packs ? html`<span class="item-pack">${packs}</span>` : ''}
        ${i.note ? html`<span class="item-note">${i.note}</span>` : ''}
      </span>
      ${i.changedAfterCheck ? html`<span class="item-changed">Besoin passé de ${formatBase(i.changedAfterCheck.fromBase, i.dim)} à ${formatBase(i.toBuyBase, i.dim)} depuis que vous l'avez coché.</span>` : ''}
    </button>
    <span class="item-price">${p.payable != null ? formatEUR(p.payable) : html`<span class="tag tag-warn">prix ?</span>`}</span>
  </li>`;
}

function receipt(b) {
  return html`<section class="receipt" aria-label="Budget de la liste">
    <h2>Budget</h2>
    <dl>
      <div><dt>Repas de la semaine</dt><dd>${formatEUR(b.meals)}</dd></div>
      <div><dt>Achats complémentaires</dt><dd>${formatEUR(b.extras)}</dd></div>
      <div class="r-total"><dt>Total estimé${b.complete ? '' : ' (partiel)'}</dt><dd>${formatEUR(b.total)}</dd></div>
      <div><dt>Déjà au panier</dt><dd>${formatEUR(b.checked)}</dd></div>
      <div><dt>Reste à payer</dt><dd>${formatEUR(b.remaining)}</dd></div>
    </dl>
    ${b.unknown ? html`<p class="r-warn">${pluralize(b.unknown, 'article sans prix', 'articles sans prix')} non compté${b.unknown > 1 ? 's' : ''} : le total réel sera plus élevé.</p>` : ''}
    <dl class="r-detail">
      <div><dt>Coût des quantités consommées</dt><dd>${formatEUR(b.consumed)}</dd></div>
      <div><dt>Surplus dû aux conditionnements</dt><dd>${formatEUR(b.surplus)}</dd></div>
      ${b.stockValue > 0 ? html`<div><dt>Valeur utilisée du stock (non dépensée)</dt><dd>${formatEUR(b.stockValue)}</dd></div>` : ''}
    </dl>
  </section>`;
}

// --- Actions ----------------------------------------------------------------------
export async function handleShopping(action, el) {
  const wid = selectedWeek();
  const id = el.dataset.id;
  switch (action) {
    case 'item-toggle': {
      await toggleItem(id);
      if (navigator.vibrate) navigator.vibrate(8);
      return true;
    }
    case 'item-edit': openItemSheet(id); return true;
    case 'item-restore': await restoreItem(id); return true;
    case 'orphan-keep': await resolveOrphan(id, true); return true;
    case 'orphan-drop': await resolveOrphan(id, false); return true;
    case 'shop-show': setUI({ shopShow: el.dataset.v }); return true;
    case 'qa-toggle': setUI({ addOpen: !state.ui.addOpen }); return true;
    case 'aisle-toggle': {
      const c = new Set(state.ui.collapsed || []);
      c.has(el.dataset.cat) ? c.delete(el.dataset.cat) : c.add(el.dataset.cat);
      setUI({ collapsed: [...c] });
      return true;
    }
    case 'shop-menu': shopMenu(wid); return true;
  }
  return false;
}

export async function handleQuickAdd(form) {
  const wid = selectedWeek();
  const f = form.elements;
  const name = f.name.value.trim();
  if (!name) { f.name.focus(); return; }
  const qty = f.qty ? parseQty(f.qty.value) : null;
  const price = f.price ? parseAmount(f.price.value) : null;
  if (Number.isNaN(qty) || Number.isNaN(price)) { toast('Quantité ou prix invalide.', { tone: 'warn' }); return; }
  const it = await addManualItem(wid, {
    name, qty, unit: f.unit ? f.unit.value || null : null, price,
    category: (f.category && f.category.value) || guessCategory(name), note: f.note ? f.note.value : '',
  });
  form.reset();
  toast(`${it.name} ajouté dans « ${it.category} »`, { action: 'Modifier', onAction: () => openItemSheet(it.id) });
}

export function openItemSheet(id) {
  const it = state.shopping.get(id);
  if (!it) return;
  const auto = it.origin === 'auto';
  const p = priceItem(it, state.ingredients, state.products);
  const recipes = (it.recipeIds || []).map(r => state.recipes.get(r)).filter(Boolean);
  const oq = it.qtyOverride;
  const s = openSheet(() => html`
    <form class="form">
      <header class="sheet-head">
        <button type="button" class="btn btn-quiet" data-close>Annuler</button>
        <h2>${auto ? it.name : 'Article'}</h2>
        <button type="submit" class="btn btn-primary btn-small">Enregistrer</button>
      </header>
      ${!auto ? html`<label class="field"><span>Nom</span><input name="name" value="${it.name}" required></label>` : html`
        <p class="hint">Issu de : ${recipes.map(r => r.name).join(', ') || '—'}.<br>
        Besoin total ${formatBase(it.needBase, it.dim)}${it.stockBase > 0 ? `, dont ${formatBase(it.stockBase, it.dim)} en stock` : ''} : <strong>${formatBase(it.toBuyBase, it.dim)} à acheter</strong>.</p>
        ${p.packs && p.packs.length ? html`<p class="hint">À prendre en rayon : ${describePacks(p.packs, state.products)} = ${formatEUR(p.payable)}${p.surplus > 0.5 ? ` (surplus ${formatBase(p.surplus, it.dim)})` : ''}${p.estimated ? ', estimation pièce ↔ poids' : ''}.</p>` : ''}
        ${p.payable == null ? html`<p class="banner banner-warn">Prix inconnu. <button type="button" class="link" data-i="ingredient">Associer un produit ou saisir un prix</button></p>` : ''}`}
      <label class="field"><span>Rayon</span><select name="category">${categoryOptions(it.category)}</select></label>
      <div class="row2">
        <label class="field"><span>${auto ? 'Quantité ajustée' : 'Quantité'} <em>facultatif</em></span><input name="qty" inputmode="decimal" value="${auto ? (oq ? String(oq.qty).replace('.', ',') : '') : (it.qty != null ? String(it.qty).replace('.', ',') : '')}" placeholder="${auto ? 'calculée' : '—'}"></label>
        <label class="field"><span>Unité</span><select name="unit">${unitOptions(auto ? (oq ? oq.unit : '') : (it.unit || ''), { allowEmpty: true })}</select></label>
      </div>
      ${auto && oq ? html`<button type="button" class="link" data-i="reset-qty">Revenir à la quantité calculée</button>` : ''}
      ${!auto ? html`<label class="field"><span>Prix estimé (€) <em>facultatif</em></span><input name="price" inputmode="decimal" value="${it.price != null ? String(it.price).replace('.', ',') : ''}" placeholder="inconnu"></label>` : ''}
      <label class="field"><span>Note</span><input name="note" value="${it.note || ''}" placeholder="ex. marque, promo"></label>
      <label class="check"><input type="checkbox" name="checked" ${it.checked ? 'checked' : ''}> Dans le panier</label>
      ${it.changedAfterCheck ? html`<button type="button" class="btn btn-small" data-i="ack">J'ai vu le changement de quantité</button>` : ''}
      <div class="btn-row">
        <button type="button" class="btn btn-small" data-i="dup">${icon('copy')} Dupliquer</button>
        ${auto ? html`<button type="button" class="btn btn-small" data-i="ingredient">${icon('tag')} Prix et produits</button>` : ''}
        <button type="button" class="btn btn-small btn-danger" data-i="del">${icon('trash')} ${auto ? 'Retirer de la liste' : 'Supprimer'}</button>
      </div>
    </form>`, { full: true, label: 'Article' });

  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const a = b.dataset.i;
    if (a === 'dup') { await duplicateItem(id); s.close(); toast('Article dupliqué'); }
    else if (a === 'del') {
      await removeItem(id); s.close();
      toast(auto ? 'Retiré de la liste (récupérable en bas de liste)' : 'Article supprimé', auto ? { action: 'Annuler', onAction: () => restoreItem(id) } : {});
    } else if (a === 'ingredient') { s.close(); openIngredientSheet(it.ingredientId); }
    else if (a === 'reset-qty') { await updateItem(id, { qtyOverride: null }); s.close(); }
    else if (a === 'ack') { await ackChange(id); s.close(); }
  });
  $('form', s.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const qty = parseQty(f.qty.value);
    const unit = normalizeUnit(f.unit.value);
    if (Number.isNaN(qty)) { toast('Quantité invalide.'); return; }
    const patch = { category: f.category.value, note: f.note.value.trim(), checked: f.checked.checked };
    if (auto) {
      if (qty != null) {
        const u = unit || (it.dim === 'masse' ? 'g' : it.dim === 'volume' ? 'ml' : it.dim);
        if (!normalizeUnit(u) || toBase(1, u).dim !== it.dim) { toast('Unité incompatible avec cet ingrédient.', { tone: 'warn' }); return; }
        patch.qtyOverride = { qty, unit: normalizeUnit(u) };
      }
    } else {
      const name = f.name.value.trim();
      if (!name) { toast('Le nom est obligatoire.'); return; }
      const price = parseAmount(f.price.value);
      if (Number.isNaN(price)) { toast('Prix invalide.'); return; }
      Object.assign(patch, { name, qty, unit: qty != null ? unit : null, price });
    }
    await updateItem(id, patch);
    s.close();
  });
}

function shopMenu(wid) {
  const s = openSheet(() => html`
    <h2 class="sheet-title">Liste de courses</h2>
    <div class="sheet-actions">
      <button type="button" class="btn" data-m="check-all">Tout cocher</button>
      <button type="button" class="btn" data-m="reset">Réinitialiser les cases</button>
      <button type="button" class="btn" data-m="sync">Recalculer depuis le planning</button>
      <button type="button" class="btn" data-m="share">Partager la liste (texte)</button>
      <button type="button" class="btn btn-quiet" data-close>Fermer</button>
    </div>`, { label: 'Liste' });
  s.el.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    s.close();
    if (m === 'reset') {
      if (await confirmSheet({ title: 'Décocher tous les articles ?', message: 'Les articles et les quantités restent ; seules les cases sont décochées.', ok: 'Réinitialiser' })) {
        await resetChecks(wid); toast('Cases réinitialisées');
      }
    } else if (m === 'check-all') {
      await setChecked(weekItems(wid).filter(isActive).map(i => i.id), true);
    } else if (m === 'sync') {
      const st = await syncList(wid);
      toast(`Liste recalculée : ${st.added} ajout(s), ${st.updated} mise(s) à jour, ${st.orphaned} à vérifier.`);
    } else if (m === 'share') {
      const text = listAsText(wid);
      try {
        if (navigator.share) await navigator.share({ title: 'Liste de courses', text });
        else { await navigator.clipboard.writeText(text); toast('Liste copiée'); }
      } catch (e) { if (e.name !== 'AbortError') await saveFile('liste-de-courses.txt', text, 'text/plain'); }
    }
  });
}

export function listAsText(wid) {
  const items = weekItems(wid).filter(isActive);
  const lines = [];
  for (const cat of CATEGORIES) {
    const g = items.filter(i => i.category === cat);
    if (!g.length) continue;
    lines.push(cat.toUpperCase());
    for (const i of g) {
      const q = itemQtyBase(i);
      lines.push(`${i.checked ? '☑' : '☐'} ${i.name}${q.qty ? ' — ' + formatBase(q.qty, q.dim) : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export { formatQty };
