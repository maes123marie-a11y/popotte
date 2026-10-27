import { html, icon, openSheet, $, toast, confirmSheet } from '../dom.js';
import { state, getWeek, weekItems, addEntry, updateEntry, removeEntry, copyWeek, markCooked, undoCooked, setUI, isPastWeek } from '../../store.js';
import { weekSummary } from '../../core/budget.js';
import { DAYS, DAYS_SHORT, SLOTS, addWeeks, weekLabel, dayDate } from '../../core/week.js';
import { formatQty } from '../../core/units.js';
import { selectedWeek, weekNav, formatEUR, formatDuration, costOf, costLabel, empty, recipesSorted, pluralize } from '../common.js';

export function renderPlanning() {
  const wid = selectedWeek();
  const week = getWeek(wid);
  const s = weekSummary(week, state.recipes, state.ingredients, state.products, weekItems(wid));
  const mode = state.ui.planMode || 'liste';
  const past = isPastWeek(wid);
  return html`
    <header class="page-head"><h1>Planning</h1>
      <div class="head-actions"><button type="button" class="icon-btn" data-action="plan-menu" aria-label="Actions sur la semaine">${icon('more')}</button></div>
    </header>
    ${weekNav(wid)}
    <div class="plan-bar" role="status" aria-live="polite">
      <div><strong>${formatEUR(s.consumed)}</strong><span>${s.consumedComplete ? 'coût des repas' : 'coût partiel'}</span></div>
      <div><strong>${s.meals}</strong><span>${s.meals > 1 ? 'repas' : 'repas'}</span></div>
      <div><strong>${formatDuration(s.prep)}</strong><span>préparation</span></div>
      <div><strong>${formatDuration(s.cook)}</strong><span>cuisson</span></div>
    </div>
    ${s.meals ? html`<p class="hint">Courses estimées : <strong>${formatEUR(s.list.meals)}</strong> pour les repas${s.list.unknownMeals ? ` (+ ${s.list.unknownMeals} sans prix)` : ''} · moyenne ${formatEUR(s.avgMeal)} par repas, ${formatEUR(s.avgPerson)} par personne.</p>` : ''}
    ${past ? html`<p class="banner">Semaine passée : vous consultez l'historique. Les modifications restent possibles.</p>` : ''}
    <div class="seg" role="tablist" aria-label="Mode d'affichage">
      <button type="button" role="tab" class="${mode === 'liste' ? 'on' : ''}" data-action="plan-mode" data-v="liste" aria-selected="${mode === 'liste'}">Sélection rapide</button>
      <button type="button" role="tab" class="${mode === 'jours' ? 'on' : ''}" data-action="plan-mode" data-v="jours" aria-selected="${mode === 'jours'}">Par jour</button>
    </div>
    ${mode === 'liste' ? listMode(wid, s) : daysMode(wid, s)}
    <button type="button" class="fab" data-action="add-meal" aria-label="Ajouter un repas">${icon('plus')}<span>Ajouter un repas</span></button>
  `;
}

function listMode(wid, s) {
  if (!s.perEntry.length) return empty('calendar', 'Semaine vide', 'Ajoutez les repas que vous voulez préparer. Un même repas peut être ajouté plusieurs fois.',
    html`<button type="button" class="btn btn-primary" data-action="add-meal">Ajouter un repas</button> <button type="button" class="btn" data-action="copy-prev">Copier la semaine précédente</button>`);
  return html`<ul class="entries">${s.perEntry.map(pe => entryRow(wid, pe))}</ul>`;
}

function daysMode(wid, s) {
  const byDay = new Map();
  const unassigned = [];
  for (const pe of s.perEntry) {
    if (pe.entry.day == null) unassigned.push(pe);
    else { const k = pe.entry.day; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(pe); }
  }
  const df = new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short' });
  return html`
    ${unassigned.length ? html`<section class="day"><h3>Sans jour fixé</h3><ul class="entries">${unassigned.map(pe => entryRow(wid, pe))}</ul></section>` : ''}
    ${DAYS.map((d, i) => {
      const list = (byDay.get(i) || []).sort((a, b) => (a.entry.slot === 'soir') - (b.entry.slot === 'soir'));
      return html`<section class="day">
        <h3>${d} <small>${df.format(dayDate(wid, i))}</small></h3>
        ${list.length ? html`<ul class="entries">${list.map(pe => entryRow(wid, pe))}</ul>` : ''}
        <div class="day-add">
          <button type="button" class="chip" data-action="add-meal" data-day="${i}" data-slot="midi">+ Midi</button>
          <button type="button" class="chip" data-action="add-meal" data-day="${i}" data-slot="soir">+ Soir</button>
        </div></section>`;
    })}`;
}

function entryRow(wid, { entry, recipe, cost, missing }) {
  if (missing || !recipe) return html`<li class="entry missing">Recette introuvable <button type="button" class="link" data-action="entry-remove" data-id="${entry.id}">Retirer</button></li>`;
  return html`<li class="entry ${entry.cooked ? 'cooked' : ''}" data-id="${entry.id}">
    <div class="entry-top">
      <a href="#/recette/${recipe.id}" class="entry-name">${recipe.name}${recipe.deletedAt ? ' (archivée)' : ''}</a>
      <button type="button" class="icon-btn" data-action="entry-menu" data-id="${entry.id}" aria-label="Actions pour ${recipe.name}">${icon('more')}</button>
    </div>
    <div class="entry-meta">
      <span><strong>${costLabel(cost)}</strong> total</span>
      <span>${costLabel(cost, 'perServing')} / pers.</span>
      <span>${icon('knife')} ${formatDuration(recipe.prepMin)}</span>
      <span>${icon('flame')} ${formatDuration(recipe.cookMin)}</span>
    </div>
    <div class="entry-ctrl">
      <div class="stepper small" aria-label="Portions">
        <button type="button" data-action="entry-serv" data-id="${entry.id}" data-d="-1" aria-label="Une portion de moins">−</button>
        <span><strong>${entry.servings}</strong> pers.</span>
        <button type="button" data-action="entry-serv" data-id="${entry.id}" data-d="1" aria-label="Une portion de plus">+</button>
      </div>
      <select data-change="entry-day" data-id="${entry.id}" aria-label="Jour">
        <option value="" ${entry.day == null ? 'selected' : ''}>Jour libre</option>
        ${DAYS.map((d, i) => html`<option value="${i}" ${entry.day === i ? 'selected' : ''}>${d}</option>`)}
      </select>
      <select data-change="entry-slot" data-id="${entry.id}" aria-label="Moment">
        <option value="" ${!entry.slot ? 'selected' : ''}>—</option>
        ${Object.entries(SLOTS).map(([k, v]) => html`<option value="${k}" ${entry.slot === k ? 'selected' : ''}>${v}</option>`)}
      </select>
    </div>
    ${entry.cooked ? html`<p class="entry-flag">${icon('check')} Cuisiné${entry.stockDeducted ? ', stock déduit' : ''}</p>` : ''}
  </li>`;
}

// --- Feuille de sélection des repas -----------------------------------------------
export function openMealPicker({ day = null, slot = null, replaceEntryId = null, recipeId = null, servings = null } = {}) {
  const wid = selectedWeek();
  if (recipeId) {
    return addEntry(wid, recipeId, { servings, day, slot }).then(() => {
      const l = weekLabel(wid);
      toast(`Ajouté à : ${l.rel.toLowerCase()}`, { action: 'Voir', onAction: () => { location.hash = '#/planning'; } });
    });
  }
  let q = '', added = 0;
  const sheet = openSheet(() => {
    const ql = q.toLocaleLowerCase('fr');
    const list = recipesSorted().filter(r => !ql || r.name.toLocaleLowerCase('fr').includes(ql));
    const counts = new Map();
    for (const e of getWeek(wid).entries) counts.set(e.recipeId, (counts.get(e.recipeId) || 0) + 1);
    return html`
      <header class="sheet-head">
        <span></span>
        <h2>${replaceEntryId ? 'Remplacer par…' : day != null ? `${DAYS[day]}${slot ? ' ' + SLOTS[slot].toLowerCase() : ''}` : 'Ajouter un repas'}</h2>
        <button type="button" class="btn btn-primary btn-small" data-close>${added ? 'Terminé' : 'Fermer'}</button>
      </header>
      <label class="search">${icon('search')}<input type="search" placeholder="Rechercher" value="${q}" data-q autocomplete="off"></label>
      ${list.length ? html`<ul class="pick-list">${list.map(r => {
        const c = costOf(r);
        const n = counts.get(r.id) || 0;
        return html`<li><button type="button" class="pick" data-pick="${r.id}">
          <span class="pick-main"><strong>${r.name}</strong>
            <small>${costLabel(c)} · ${costLabel(c, 'perServing')}/pers. · ${r.servings} pers.</small>
            <small>${icon('knife')} ${formatDuration(r.prepMin)} ${icon('flame')} ${formatDuration(r.cookMin)}</small></span>
          <span class="pick-add">${n ? html`<span class="pill">${n}×</span>` : ''}${icon(replaceEntryId ? 'swap' : 'plus')}</span>
        </button></li>`;
      })}</ul>` : html`<p class="hint">${recipesSorted().length ? 'Aucune recette ne correspond.' : 'Aucune recette dans votre bibliothèque.'}</p>
        <a class="btn btn-primary btn-block" href="#/recette/nouvelle" data-close>Créer une recette</a>`}`;
  }, { full: true, label: 'Choisir un repas' });

  sheet.el.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) { q = e.target.value; sheet.render(); const i = $('[data-q]', sheet.el); i.focus(); i.setSelectionRange(q.length, q.length); }
  });
  sheet.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const rid = b.dataset.pick;
    if (replaceEntryId) {
      const r = state.recipes.get(rid);
      await updateEntry(wid, replaceEntryId, { recipeId: rid, servings: r.servings, cooked: false });
      sheet.close(); toast(`Remplacé par ${r.name}`);
      return;
    }
    await addEntry(wid, rid, { day, slot });
    added++;
    sheet.render();
    toast(`${state.recipes.get(rid).name} ajouté (${pluralize(getWeek(wid).entries.length, 'repas', 'repas')})`);
  });
  return sheet;
}

export async function handlePlanning(action, el) {
  const wid = selectedWeek();
  const id = el.dataset.id;
  switch (action) {
    case 'plan-mode': setUI({ planMode: el.dataset.v }); return true;
    case 'add-meal': openMealPicker({ day: el.dataset.day != null ? Number(el.dataset.day) : null, slot: el.dataset.slot || null }); return true;
    case 'entry-serv': {
      const e = getWeek(wid).entries.find(x => x.id === id);
      if (e) await updateEntry(wid, id, { servings: Math.max(1, Math.min(50, e.servings + Number(el.dataset.d))) });
      return true;
    }
    case 'entry-remove': await removeEntry(wid, id); return true;
    case 'entry-menu': entryMenu(wid, id); return true;
    case 'copy-prev': {
      const prev = addWeeks(wid, -1);
      if (!getWeek(prev).entries.length) { toast('La semaine précédente est vide.'); return true; }
      await copyWeek(prev, wid); toast('Repas de la semaine précédente copiés'); return true;
    }
    case 'plan-menu': weekMenu(wid); return true;
  }
  return false;
}

export async function handlePlanningChange(kind, el) {
  const wid = selectedWeek();
  if (kind === 'entry-day') await updateEntry(wid, el.dataset.id, { day: el.value === '' ? null : Number(el.value) });
  else if (kind === 'entry-slot') await updateEntry(wid, el.dataset.id, { slot: el.value || null });
  else return false;
  return true;
}

function entryMenu(wid, id) {
  const e = getWeek(wid).entries.find(x => x.id === id);
  if (!e) return;
  const r = state.recipes.get(e.recipeId);
  const s = openSheet(() => html`
    <h2 class="sheet-title">${r ? r.name : 'Repas'}</h2>
    <div class="sheet-actions">
      ${!e.cooked ? html`
        <button type="button" class="btn btn-primary" data-m="cook-deduct" ${state.settings.stockEnabled ? '' : 'hidden'}>Cuisiné : déduire du stock</button>
        <button type="button" class="btn" data-m="cook">Marquer comme cuisiné</button>`
      : html`<button type="button" class="btn" data-m="uncook">${e.stockDeducted ? 'Annuler « cuisiné » et rendre au stock' : 'Annuler « cuisiné »'}</button>`}
      <button type="button" class="btn" data-m="replace">Remplacer par un autre repas</button>
      <button type="button" class="btn" data-m="dup">Programmer une deuxième fois</button>
      <button type="button" class="btn btn-danger" data-m="remove">Retirer de la semaine</button>
      <button type="button" class="btn btn-quiet" data-close>Fermer</button>
    </div>`, { label: 'Actions' });
  s.el.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    s.close();
    if (m === 'cook' || m === 'cook-deduct') {
      const res = await markCooked(wid, id, { deduct: m === 'cook-deduct' });
      if (m === 'cook-deduct') {
        toast(res.missing.length ? `Stock déduit. ${res.missing.length} ingrédient(s) n'étaient pas (assez) en stock.` : 'Stock déduit', { ms: 5000 });
      }
    } else if (m === 'uncook') await undoCooked(wid, id);
    else if (m === 'replace') openMealPicker({ replaceEntryId: id });
    else if (m === 'dup') await addEntry(wid, e.recipeId, { servings: e.servings });
    else if (m === 'remove') {
      await removeEntry(wid, id);
      toast('Repas retiré', { action: 'Annuler', onAction: () => addEntry(wid, e.recipeId, { servings: e.servings, day: e.day, slot: e.slot }) });
    }
  });
}

function weekMenu(wid) {
  const s = openSheet(() => html`
    <h2 class="sheet-title">Semaine</h2>
    <div class="sheet-actions">
      <button type="button" class="btn" data-m="copy">Copier les repas de la semaine précédente</button>
      <button type="button" class="btn" data-m="next">Planifier la semaine suivante</button>
      <button type="button" class="btn btn-danger" data-m="clear">Retirer tous les repas</button>
      <button type="button" class="btn btn-quiet" data-close>Fermer</button>
    </div>`, { label: 'Semaine' });
  s.el.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    s.close();
    if (m === 'copy') await handlePlanning('copy-prev', { dataset: {} });
    if (m === 'next') setUI({ weekId: addWeeks(wid, 1) }, { immediate: true });
    if (m === 'clear') {
      if (!(await confirmSheet({ title: 'Retirer tous les repas ?', message: 'Les articles ajoutés à la main dans la liste de courses sont conservés.', ok: 'Retirer', danger: true }))) return;
      for (const e of [...getWeek(wid).entries]) await removeEntry(wid, e.id);
    }
  });
}

export { formatQty, DAYS_SHORT };
