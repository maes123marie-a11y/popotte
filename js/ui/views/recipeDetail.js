import { html, icon } from '../dom.js';
import { state } from '../../store.js';
import { formatQty } from '../../core/units.js';
import { costOf, costLabel, formatEUR, formatDuration, empty } from '../common.js';

const view = { servings: new Map() };

export function detailServings(id, r) { return view.servings.get(id) || r.servings; }
export function setDetailServings(id, n) { view.servings.set(id, Math.max(1, Math.min(50, n))); }

export function renderRecipeDetail(id) {
  const r = state.recipes.get(id);
  if (!r) return empty('book', 'Recette introuvable', 'Elle a peut-être été supprimée.', html`<a class="btn" href="#/recettes">Retour aux recettes</a>`);
  const s = detailServings(id, r);
  const c = costOf(r, s);
  return html`
    <header class="page-head page-head-back">
      <a class="icon-btn" href="#/recettes" aria-label="Retour">${icon('chev-left')}</a>
      <div class="head-actions">
        <button type="button" class="icon-btn" data-action="recipe-dup" data-id="${r.id}" aria-label="Dupliquer">${icon('copy')}</button>
        <button type="button" class="icon-btn" data-action="recipe-del" data-id="${r.id}" aria-label="Supprimer">${icon('trash')}</button>
        <a class="btn btn-small" href="#/recette/${r.id}/modifier">Modifier</a>
      </div>
    </header>
    ${r.deletedAt ? html`<p class="banner banner-warn">Recette archivée : elle reste visible dans l'historique des semaines passées.</p>` : ''}
    <article class="recipe">
      ${r.photoId ? html`<div class="recipe-photo" data-photo="${r.photoId}"></div>` : ''}
      <p class="recipe-cat">${r.category}${r.demo ? ' · exemple' : ''}</p>
      <h1 class="recipe-title">${r.name}</h1>
      ${r.description ? html`<p class="recipe-desc">${r.description}</p>` : ''}
      <div class="recipe-facts">
        <div><span>Préparation</span><strong>${formatDuration(r.prepMin)}</strong></div>
        <div><span>Cuisson</span><strong>${formatDuration(r.cookMin)}</strong></div>
        <div class="stepper" aria-label="Portions">
          <button type="button" data-action="detail-serv" data-d="-1" aria-label="Moins de portions">−</button>
          <span><strong>${s}</strong> pers.</span>
          <button type="button" data-action="detail-serv" data-d="1" aria-label="Plus de portions">+</button>
        </div>
      </div>
      ${s !== r.servings ? html`<p class="hint">Quantités recalculées pour ${s} personnes. La recette reste enregistrée pour ${r.servings}.</p>` : ''}

      <section class="cost-box ${c.complete ? '' : 'incomplete'}">
        <div><span>Coût des ingrédients</span><strong>${costLabel(c)}</strong></div>
        <div><span>Par personne</span><strong>${c.lines.length ? costLabel(c, 'perServing') : '—'}</strong></div>
        ${!c.complete && c.lines.length ? html`<p>${c.unknownCount} ingrédient${c.unknownCount > 1 ? 's' : ''} sans prix : le total est partiel. Touchez un ingrédient pour saisir un prix ou associer un produit.</p>` : ''}
        ${c.estimated ? html`<p>Certains coûts utilisent une correspondance pièce ↔ poids que vous avez définie.</p>` : ''}
      </section>

      <h2 class="sec-title">Ingrédients</h2>
      <ul class="ing-list">
        ${c.lines.map(l => html`<li>
          <button type="button" class="ing-row" data-action="ingredient-sheet" data-id="${l.item.ingredientId}">
            <span class="ing-qty">${formatQty(l.qty, l.unit)}</span>
            <span class="ing-name">${l.ingredient ? l.ingredient.name : 'Ingrédient supprimé'}${l.item.optional ? html` <em class="tag">facultatif</em>` : ''}</span>
            <span class="ing-cost">${l.cost != null ? html`${formatEUR(l.cost)}${l.share != null && c.lines.length > 1 ? html`<small>${Math.round(l.share * 100)} %</small>` : ''}` : html`<span class="tag tag-warn">prix ?</span>`}</span>
          </button></li>`)}
      </ul>
      ${!c.lines.length ? html`<p class="hint">Aucun ingrédient. Modifiez la recette pour en ajouter.</p>` : ''}

      ${r.steps && r.steps.length ? html`<h2 class="sec-title">Préparation</h2>
        <ol class="steps">${r.steps.map(st => html`<li>${st}</li>`)}</ol>` : ''}
      ${r.notes ? html`<h2 class="sec-title">Notes</h2><p class="notes">${r.notes}</p>` : ''}
      ${!r.deletedAt ? html`<button type="button" class="btn btn-primary btn-big btn-block" data-action="plan-recipe" data-id="${r.id}" data-servings="${s}">${icon('calendar-plus')} Ajouter à la semaine</button>` : ''}
    </article>`;
}
