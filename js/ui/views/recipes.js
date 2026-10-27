import { html, icon } from '../dom.js';
import { state, setUI } from '../../store.js';
import { RECIPE_CATEGORIES } from '../../core/shopping.js';
import { costOf, costLabel, costBadge, formatDuration, empty, recipesSorted } from '../common.js';

const SORTS = {
  nom: ['Nom', (a, b) => a.r.name.localeCompare(b.r.name, 'fr')],
  cout: ['Moins chers', (a, b) => a.c.perServing - b.c.perServing],
  temps: ['Plus rapides', (a, b) => (a.r.prepMin + a.r.cookMin) - (b.r.prepMin + b.r.cookMin)],
  recent: ['Récents', (a, b) => String(b.r.createdAt).localeCompare(String(a.r.createdAt))],
};

export function libraryState() {
  return { q: state.ui.libQ || '', cat: state.ui.libCat || '', sort: state.ui.libSort || 'nom', maxTime: state.ui.libMaxTime || 0 };
}

export function filteredRecipes(f = libraryState()) {
  const q = f.q.trim().toLocaleLowerCase('fr');
  let list = recipesSorted().map(r => ({ r, c: costOf(r) }));
  if (q) list = list.filter(({ r }) => r.name.toLocaleLowerCase('fr').includes(q) ||
    (r.items || []).some(it => (state.ingredients.get(it.ingredientId)?.name || '').toLocaleLowerCase('fr').includes(q)));
  if (f.cat) list = list.filter(({ r }) => r.category === f.cat);
  if (f.maxTime) list = list.filter(({ r }) => (r.prepMin + r.cookMin) <= f.maxTime);
  const sorter = (SORTS[f.sort] || SORTS.nom)[1];
  // Les recettes au coût incomplet passent après dans le tri par prix.
  if (f.sort === 'cout') list.sort((a, b) => (a.c.complete === b.c.complete ? sorter(a, b) : a.c.complete ? -1 : 1));
  else list.sort(sorter);
  return list;
}

export function renderRecipes() {
  const f = libraryState();
  const total = recipesSorted().length;
  const list = filteredRecipes(f);
  return html`
    <header class="page-head">
      <h1>Recettes</h1>
      <div class="head-actions">
        <button type="button" class="icon-btn" data-action="import-recipes" aria-label="Importer des recettes">${icon('download')}</button>
        <a class="icon-btn icon-btn-primary" href="#/recette/nouvelle" aria-label="Ajouter un repas">${icon('plus')}</a>
      </div>
    </header>
    ${total ? html`
    <div class="toolbar">
      <label class="search">${icon('search')}<input type="search" placeholder="Rechercher un repas ou un ingrédient" value="${f.q}" data-input="lib-q" autocomplete="off"></label>
      <div class="chips" role="group" aria-label="Catégories">
        <button type="button" class="chip ${!f.cat ? 'on' : ''}" data-action="lib-cat" data-v="">Toutes</button>
        ${RECIPE_CATEGORIES.map(c => html`<button type="button" class="chip ${f.cat === c ? 'on' : ''}" data-action="lib-cat" data-v="${c}">${c}</button>`)}
      </div>
      <div class="chips" role="group" aria-label="Tri et filtres">
        ${Object.entries(SORTS).map(([k, [l]]) => html`<button type="button" class="chip chip-sort ${f.sort === k ? 'on' : ''}" data-action="lib-sort" data-v="${k}">${l}</button>`)}
        <button type="button" class="chip chip-sort ${f.maxTime ? 'on' : ''}" data-action="lib-time">${f.maxTime ? `≤ ${f.maxTime} min` : 'Durée max.'}</button>
      </div>
    </div>
    ${list.length ? html`<ul class="cards">${list.map(({ r, c }) => card(r, c))}</ul>`
      : empty('search', 'Aucun résultat', 'Modifiez la recherche ou les filtres.', html`<button type="button" class="btn" data-action="lib-reset">Effacer les filtres</button>`)}
    ` : empty('book', 'Votre bibliothèque est vide', 'Ajoutez une recette avec ses ingrédients : l\'application calculera son coût et la liste de courses.',
      html`<a class="btn btn-primary" href="#/recette/nouvelle">Ajouter un repas</a> <button type="button" class="btn" data-action="import-recipes">Importer</button>`)}
  `;
}

function card(r, c) {
  return html`<li class="card">
    <a href="#/recette/${r.id}" class="card-link">
      <div class="card-photo ${r.photoId ? '' : 'no-photo'}" ${r.photoId ? html`data-photo="${r.photoId}"` : ''}>
        ${!r.photoId ? html`<span class="card-initial" aria-hidden="true">${r.name.slice(0, 1)}</span>` : ''}
        <span class="card-cat">${r.category}</span>
        ${r.demo ? html`<span class="card-demo">Exemple</span>` : ''}
      </div>
      <div class="card-body">
        <h3>${r.name}</h3>
        <p class="card-meta">${formatDuration((r.prepMin || 0) + (r.cookMin || 0))} · ${r.servings} pers.</p>
        <p class="card-price"><strong>${costLabel(c)}</strong> <span>${c.lines.length && !(c.total === 0 && c.unknownCount) ? `${costLabel(c, 'perServing')} / pers.` : ''}</span></p>
        ${costBadge(c)}
      </div>
    </a>
    <button type="button" class="card-add" data-action="plan-recipe" data-id="${r.id}" aria-label="Planifier ${r.name}">${icon('calendar-plus')}</button>
  </li>`;
}

export function handleLibrary(action, el) {
  if (action === 'lib-cat') setUI({ libCat: el.dataset.v });
  else if (action === 'lib-sort') setUI({ libSort: el.dataset.v });
  else if (action === 'lib-time') {
    const steps = [0, 20, 30, 45, 60];
    const cur = state.ui.libMaxTime || 0;
    setUI({ libMaxTime: steps[(steps.indexOf(cur) + 1) % steps.length] });
  } else if (action === 'lib-reset') setUI({ libQ: '', libCat: '', libMaxTime: 0 });
  else return false;
  return true;
}
