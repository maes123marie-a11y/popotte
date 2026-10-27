import { html, icon, openSheet, $, $$, toast, resizeImage, esc, confirmSheet } from '../dom.js';
import { state, saveRecipe, createIngredient, sortedIngredients, findIngredientByName, photoURL } from '../../store.js';
import { normalizeUnit, formatQty, unitLabel } from '../../core/units.js';
import { parseQty } from '../../core/money.js';
import { guessCategory } from '../../core/shopping.js';
import { unitOptions, recipeCategoryOptions, categoryOptions } from '../common.js';
import { openIngredientSheet } from './ingredientSheet.js';

export function openRecipeForm(id, { onSaved } = {}) {
  const src = id ? state.recipes.get(id) : null;
  const d = src ? JSON.parse(JSON.stringify(src)) : {
    name: '', description: '', servings: 2, prepMin: 15, cookMin: 20, category: 'Autre', items: [], steps: [''], notes: '',
  };
  if (!d.steps.length) d.steps = [''];
  let photoBlob = null, removePhoto = false, dirty = false;

  const sheet = openSheet(() => html`
    <form class="form" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn btn-quiet" data-act="cancel">Annuler</button>
        <h2>${src ? 'Modifier la recette' : 'Ajouter un repas'}</h2>
        <button type="submit" class="btn btn-primary btn-small">Enregistrer</button>
      </header>
      <label class="photo-pick" data-photo-slot>
        <input type="file" accept="image/*" name="photo" hidden>
        <span class="photo-pick-empty">${icon('camera')} Ajouter une photo</span>
      </label>
      <div class="photo-tools" hidden><button type="button" class="link" data-act="rm-photo">Retirer la photo</button></div>

      <label class="field"><span>Nom du repas</span><input name="name" required value="${d.name}" placeholder="Ex. : Chicons au gratin" autocomplete="off"></label>
      <label class="field"><span>Description <em>facultatif</em></span><textarea name="description" rows="2">${d.description}</textarea></label>
      <div class="row3">
        <label class="field"><span>Portions</span><input name="servings" type="number" inputmode="numeric" min="1" max="100" value="${d.servings}"></label>
        <label class="field"><span>Prépa (min)</span><input name="prepMin" type="number" inputmode="numeric" min="0" value="${d.prepMin}"></label>
        <label class="field"><span>Cuisson (min)</span><input name="cookMin" type="number" inputmode="numeric" min="0" value="${d.cookMin}"></label>
      </div>
      <label class="field"><span>Catégorie</span><select name="category">${recipeCategoryOptions(d.category)}</select></label>

      <h3 class="form-sec">Ingrédients <small>pour ${d.servings} personne(s)</small></h3>
      <div class="ing-add" role="group" aria-label="Ajouter un ingrédient">
        <input class="ia-name" list="ing-datalist" placeholder="Ingrédient" autocomplete="off" enterkeyhint="next" aria-label="Nom de l'ingrédient">
        <input class="ia-qty" inputmode="decimal" placeholder="Qté" enterkeyhint="done" aria-label="Quantité">
        <select class="ia-unit" aria-label="Unité">${unitOptions('g')}</select>
        <button type="button" class="btn btn-primary ia-btn" data-act="add-ing" aria-label="Ajouter l'ingrédient">${icon('plus')}</button>
      </div>
      <datalist id="ing-datalist">${sortedIngredients().map(i => html`<option value="${i.name}">`)}</datalist>
      <p class="hint">Tapez le nom, la quantité puis Entrée : le champ se vide pour l'ingrédient suivant.</p>
      <ul class="ing-edit" data-slot="items"></ul>

      <h3 class="form-sec">Étapes</h3>
      <ol class="steps-edit" data-slot="steps"></ol>
      <button type="button" class="btn btn-small" data-act="add-step">${icon('plus')} Ajouter une étape</button>

      <label class="field"><span>Notes personnelles <em>facultatif</em></span><textarea name="notes" rows="3">${d.notes}</textarea></label>
      <button type="submit" class="btn btn-primary btn-big btn-block">Enregistrer la recette</button>
    </form>`, { full: true, label: 'Recette', onClose: () => {} });

  const root = sheet.el;
  const form = $('form', root);

  const renderItems = () => {
    $('[data-slot="items"]', root).innerHTML = d.items.map((it, i) => {
      const ing = state.ingredients.get(it.ingredientId);
      const hasPrice = ing && ((ing.productIds || []).length || ing.manualPrice);
      return html`<li data-i="${i}">
        <div class="ie-main">
          <strong>${ing ? ing.name : '?'}</strong>
          <button type="button" class="tag ${hasPrice ? 'tag-verifie' : 'tag-warn'}" data-act="price" data-i="${i}">${hasPrice ? 'Prix' : 'Ajouter un prix'}</button>
        </div>
        <div class="ie-ctrl">
          <input inputmode="decimal" value="${String(it.qty).replace('.', ',')}" data-f="qty" data-i="${i}" aria-label="Quantité">
          <select data-f="unit" data-i="${i}" aria-label="Unité">${unitOptions(it.unit)}</select>
          <label class="opt"><input type="checkbox" data-f="optional" data-i="${i}" ${it.optional ? 'checked' : ''}> facult.</label>
          <button type="button" class="icon-btn" data-act="rm-ing" data-i="${i}" aria-label="Retirer ${esc(ing ? ing.name : '')}">${icon('x')}</button>
        </div></li>`.s;
    }).join('') || '<li class="hint">Aucun ingrédient pour l\'instant.</li>';
  };
  const renderSteps = () => {
    $('[data-slot="steps"]', root).innerHTML = d.steps.map((s, i) => html`<li>
      <textarea rows="2" data-step="${i}" placeholder="Étape ${i + 1}">${s}</textarea>
      ${d.steps.length > 1 ? html`<button type="button" class="icon-btn" data-act="rm-step" data-i="${i}" aria-label="Supprimer l'étape ${i + 1}">${icon('x')}</button>` : ''}
    </li>`.s).join('');
  };
  const showPhoto = async (url) => {
    const slot = $('[data-photo-slot]', root);
    slot.style.backgroundImage = url ? `url("${url}")` : '';
    slot.classList.toggle('has-photo', !!url);
    $('.photo-tools', root).hidden = !url;
  };
  renderItems(); renderSteps();
  if (src && src.photoId) photoURL(src.photoId).then(showPhoto);

  const nameIn = $('.ia-name', root), qtyIn = $('.ia-qty', root), unitIn = $('.ia-unit', root);
  nameIn.addEventListener('change', () => {
    const ex = findIngredientByName(nameIn.value);
    if (ex && ex.defaultUnit) unitIn.value = ex.defaultUnit;
  });

  async function addIngredient() {
    const name = nameIn.value.trim();
    const qty = parseQty(qtyIn.value);
    if (!name) { nameIn.focus(); return; }
    if (!(qty > 0)) { qtyIn.focus(); toast('Indiquez une quantité supérieure à zéro.'); return; }
    const unit = normalizeUnit(unitIn.value);
    const ing = await createIngredient({ name, category: guessCategory(name), defaultUnit: unit });
    d.items.push({ ingredientId: ing.id, qty, unit, optional: false });
    dirty = true;
    nameIn.value = ''; qtyIn.value = '';
    renderItems();
    nameIn.focus();
  }

  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qtyIn.focus(); } });
  qtyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } });

  root.addEventListener('input', (e) => {
    dirty = true;
    const t = e.target;
    if (t.dataset.step != null) d.steps[Number(t.dataset.step)] = t.value;
    if (t.name === 'servings') $('.form-sec small', root).textContent = `pour ${t.value || '?'} personne(s)`;
  });
  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'photo' && t.files && t.files[0]) {
      try {
        photoBlob = await resizeImage(t.files[0]); removePhoto = false;
        showPhoto(URL.createObjectURL(photoBlob));
      } catch { toast('Impossible de lire cette image.'); }
      return;
    }
    if (t.dataset.f) {
      const it = d.items[Number(t.dataset.i)];
      if (t.dataset.f === 'qty') it.qty = parseQty(t.value);
      if (t.dataset.f === 'unit') it.unit = t.value;
      if (t.dataset.f === 'optional') it.optional = t.checked;
    }
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'cancel') {
      if (dirty && !(await confirmSheet({ title: 'Abandonner les modifications ?', ok: 'Abandonner', danger: true }))) return;
      sheet.close();
    } else if (a === 'add-ing') addIngredient();
    else if (a === 'rm-ing') { d.items.splice(Number(b.dataset.i), 1); dirty = true; renderItems(); }
    else if (a === 'price') {
      const it = d.items[Number(b.dataset.i)];
      openIngredientSheet(it.ingredientId, { onClose: renderItems, contextQty: { qty: it.qty, unit: it.unit } });
    } else if (a === 'add-step') { d.steps.push(''); renderSteps(); $$('[data-step]', root).at(-1).focus(); }
    else if (a === 'rm-step') { d.steps.splice(Number(b.dataset.i), 1); renderSteps(); }
    else if (a === 'rm-photo') { photoBlob = null; removePhoto = true; showPhoto(null); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Ingrédient tapé mais pas encore ajouté
    if (nameIn.value.trim() && qtyIn.value.trim()) await addIngredient();
    const f = new FormData(form);
    const draft = {
      ...d, id: src ? src.id : undefined,
      name: String(f.get('name') || '').trim(), description: String(f.get('description') || '').trim(),
      servings: Number(f.get('servings')), prepMin: Number(f.get('prepMin')) || 0, cookMin: Number(f.get('cookMin')) || 0,
      category: f.get('category'), notes: String(f.get('notes') || '').trim(),
    };
    const errs = [];
    if (!draft.name) errs.push('le nom');
    if (!(draft.servings >= 1)) errs.push('le nombre de portions');
    const bad = draft.items.findIndex(it => !(it.qty > 0) || !normalizeUnit(it.unit));
    if (bad >= 0) errs.push(`la quantité de « ${state.ingredients.get(draft.items[bad].ingredientId)?.name} »`);
    if (errs.length) { toast(`Vérifiez ${errs.join(', ')}.`, { tone: 'warn' }); return; }
    try {
      const r = await saveRecipe(draft, { photoBlob, removePhoto });
      sheet.close();
      toast(src ? 'Recette enregistrée' : 'Recette ajoutée');
      onSaved && onSaved(r);
    } catch (err) {
      toast('Enregistrement impossible : ' + err.message, { tone: 'warn', ms: 6000 });
    }
  });
  if (!src) setTimeout(() => $('input[name="name"]', root).focus(), 250);
  return sheet;
}

export { formatQty, unitLabel, categoryOptions };
