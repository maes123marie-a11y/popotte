// Composants partagés entre les écrans.
import { html, raw, icon } from './dom.js';
import { state, currentWeekId, setUI, liveRecipes } from '../store.js';
import { weekLabel, addWeeks } from '../core/week.js';
import { recipeCost, priceStatus, PRICE_STATUS, referencePrice } from '../core/costing.js';
import { formatEUR } from '../core/money.js';
import { formatDuration } from '../core/budget.js';
import { UNIT_ORDER, UNITS } from '../core/units.js';
import { CATEGORIES, RECIPE_CATEGORIES } from '../core/shopping.js';

export { formatEUR, formatDuration };

export const selectedWeek = () => state.ui.weekId || currentWeekId();
export function setWeek(id) { setUI({ weekId: id }, { immediate: true }); }

export function weekNav(id, { compact = false } = {}) {
  const l = weekLabel(id);
  const isCur = id === currentWeekId();
  return html`
    <nav class="weeknav ${compact ? 'compact' : ''}" aria-label="Choix de la semaine">
      <button type="button" class="icon-btn" data-action="week-prev" aria-label="Semaine précédente">${icon('chev-left')}</button>
      <button type="button" class="weeknav-label" data-action="week-pick">
        <strong>${l.rel}</strong><span>${l.range}</span>
      </button>
      <button type="button" class="icon-btn" data-action="week-next" aria-label="Semaine suivante">${icon('chev-right')}</button>
      ${!isCur ? html`<button type="button" class="chip chip-small" data-action="week-today">Aujourd'hui</button>` : ''}
    </nav>`;
}

export function handleWeekNav(action) {
  const id = selectedWeek();
  if (action === 'week-prev') setWeek(addWeeks(id, -1));
  else if (action === 'week-next') setWeek(addWeeks(id, 1));
  else if (action === 'week-today') setWeek(currentWeekId());
  else return false;
  return true;
}

const costCache = new Map();
let costStamp = 0;
export function invalidateCosts() { costCache.clear(); costStamp++; }
export function costOf(recipe, servings) {
  const k = `${recipe.id}|${recipe.updatedAt}|${servings ?? recipe.servings}`;
  if (!costCache.has(k)) costCache.set(k, recipeCost(recipe, servings ?? recipe.servings, state.ingredients, state.products));
  return costCache.get(k);
}

// « 3,20 € » ou « ≥ 3,20 € » si incomplet, ou « Prix inconnu ».
export function costLabel(c, field = 'total') {
  if (!c.lines.length) return 'Aucun ingrédient';
  if (c.total === 0 && c.unknownCount) return 'Prix inconnu';
  const v = formatEUR(c[field]);
  return c.complete ? v : `≥ ${v}`;
}

export function costBadge(c) {
  if (!c.lines.length) return '';
  if (c.complete) return c.estimated ? html`<span class="tag tag-warn" title="Conversion pièce ↔ poids estimée">estimé</span>` : '';
  return html`<span class="tag tag-warn">${c.unknownCount} prix manquant${c.unknownCount > 1 ? 's' : ''}</span>`;
}

export function statusTag(p) {
  const s = priceStatus(p, Date.now(), state.settings.staleDays);
  return html`<span class="tag tag-${s}">${PRICE_STATUS[s]}</span>`;
}

export function refPriceLabel(p) {
  const r = referencePrice(p);
  return r ? `${formatEUR(r.price)}/${r.per}` : '';
}

export function unitOptions(selected, { allowEmpty = false } = {}) {
  return raw((allowEmpty ? `<option value="">—</option>` : '') + UNIT_ORDER.map(u =>
    `<option value="${u}" ${u === selected ? 'selected' : ''}>${UNITS[u].label}</option>`).join(''));
}

export function categoryOptions(selected, list = CATEGORIES) {
  return raw(list.map(c => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join(''));
}
export const recipeCategoryOptions = (sel) => categoryOptions(sel, RECIPE_CATEGORIES);

export function empty(iconName, title, text, actions = '') {
  return html`<div class="empty">${icon(iconName, 'empty-ic')}<h2>${title}</h2><p>${text}</p>${actions}</div>`;
}

export function recipeTimes(r) {
  return html`<span class="times"><span title="Préparation">${icon('knife')} ${formatDuration(r.prepMin)}</span><span title="Cuisson">${icon('flame')} ${formatDuration(r.cookMin)}</span></span>`;
}

export function dateFR(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('fr-BE', opts).format(d);
}

export const recipesSorted = () => liveRecipes().sort((a, b) => a.name.localeCompare(b.name, 'fr'));

export function pluralize(n, one, many) { return `${n} ${n > 1 ? many : one}`; }
