import { html, icon } from '../dom.js';
import { state, getWeek, weekItems, currentWeekId } from '../../store.js';
import { weekSummary } from '../../core/budget.js';
import { progress } from '../../core/shopping.js';
import { addWeeks, DAYS_SHORT, SLOTS } from '../../core/week.js';
import { selectedWeek, weekNav, formatEUR, formatDuration, costLabel, empty, pluralize } from '../common.js';

export function renderHome() {
  const wid = selectedWeek();
  const week = getWeek(wid);
  const items = weekItems(wid);
  const s = weekSummary(week, state.recipes, state.ingredients, state.products, items);
  const pr = progress(items);
  const hasRecipes = [...state.recipes.values()].some(r => !r.deletedAt);
  const backupDue = needsBackup();

  return html`
    <header class="page-head">
      <h1>Popote</h1>
      <div class="head-actions">
        <a class="icon-btn" href="#/stock" aria-label="Stock">${icon('box')}</a>
        <a class="icon-btn" href="#/reglages" aria-label="Réglages">${icon('gear')}</a>
      </div>
    </header>
    ${weekNav(wid)}
    ${backupDue ? html`<a class="banner" href="#/reglages">${icon('shield')}<span>${backupDue}</span></a>` : ''}

    <section class="summary" aria-label="Résumé de la semaine">
      <div class="sum-main">
        <span class="sum-label">Budget courses estimé</span>
        <strong class="sum-big">${s.list.count ? formatEUR(s.list.total) : formatEUR(s.consumed)}</strong>
        ${s.list.unknown ? html`<span class="sum-note">${pluralize(s.list.unknown, 'article', 'articles')} sans prix non compté${s.list.unknown > 1 ? 's' : ''}</span>`
          : !s.consumedComplete ? html`<span class="sum-note">Certains ingrédients n'ont pas de prix</span>` : ''}
      </div>
      <dl class="sum-grid">
        <div><dt>Repas</dt><dd>${s.meals}</dd></div>
        <div><dt>Préparation</dt><dd>${formatDuration(s.prep)}</dd></div>
        <div><dt>Cuisson</dt><dd>${formatDuration(s.cook)}</dd></div>
        <div><dt>Par personne</dt><dd>${s.servings ? formatEUR(s.avgPerson) : '—'}</dd></div>
      </dl>
    </section>

    <div class="quick">
      <button type="button" class="btn btn-primary btn-big" data-action="add-meal">${icon('plus')} Ajouter un repas</button>
      <a class="btn btn-big btn-list" href="#/courses">${icon('cart')} Liste de courses
        ${pr.total ? html`<span class="pill">${pr.done}/${pr.total}</span>` : ''}</a>
    </div>

    <section class="block">
      <div class="block-head"><h2>Repas de la semaine</h2><a href="#/planning" class="link">Planning</a></div>
      ${!week.entries.length ? (hasRecipes
        ? empty('calendar', 'Aucun repas prévu', 'Choisissez des recettes de votre bibliothèque pour cette semaine.',
            html`<button type="button" class="btn btn-primary" data-action="add-meal">Choisir des repas</button>`)
        : empty('book', 'Commencez par une recette', 'Ajoutez votre première recette, ou chargez des exemples depuis les réglages pour découvrir l\'application.',
            html`<a class="btn btn-primary" href="#/recette/nouvelle">Créer une recette</a> <a class="btn" href="#/reglages">Charger des exemples</a>`))
      : html`<ul class="meal-list">${s.perEntry.map(pe => mealRow(pe))}</ul>`}
    </section>

    <section class="block shortcuts">
      <a href="#/recettes" class="shortcut">${icon('book')}<span>Recettes</span></a>
      <a href="#/stock" class="shortcut">${icon('box')}<span>Stock</span></a>
      <a href="#/produits" class="shortcut">${icon('tag')}<span>Produits et prix</span></a>
      <button type="button" class="shortcut" data-action="new-week">${icon('calendar-plus')}<span>Nouvelle semaine</span></button>
    </section>
  `;
}

function mealRow({ entry, recipe, cost, missing }) {
  if (missing || !recipe) return html`<li class="meal missing">Recette supprimée</li>`;
  const when = entry.day != null ? `${DAYS_SHORT[entry.day]}${entry.slot ? ' ' + SLOTS[entry.slot].toLowerCase() : ''}` : 'Cette semaine';
  return html`<li class="meal ${entry.cooked ? 'cooked' : ''}">
    <a href="#/recette/${recipe.id}">
      <span class="meal-when">${when}</span>
      <span class="meal-name">${recipe.name}</span>
      <span class="meal-meta">${entry.servings} pers. · ${formatDuration((recipe.prepMin || 0) + (recipe.cookMin || 0))} · ${costLabel(cost)}</span>
    </a></li>`;
}

export function needsBackup() {
  const st = state.settings;
  const n = [...state.recipes.values()].filter(r => !r.demo && !r.deletedAt).length;
  if (n < 1) return null;
  const days = st.backupReminderDays || 14;
  if (!st.lastBackupAt) return 'Vos données ne sont que sur cet iPhone. Faites une première sauvegarde.';
  const age = (Date.now() - Date.parse(st.lastBackupAt)) / 86400000;
  return age > days ? `Dernière sauvegarde il y a ${Math.floor(age)} jours. Pensez à en refaire une.` : null;
}

export function nextUnplannedWeek() {
  let id = currentWeekId();
  for (let i = 0; i < 52; i++) {
    const w = state.weeks.get(id);
    if (!w || !w.entries.length) return id;
    id = addWeeks(id, 1);
  }
  return id;
}
