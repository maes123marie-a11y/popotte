// Point d'entrée : routeur, rendu, délégation d'événements, service worker.
import { $, html, toast, closeTopSheet, closeAllSheets, sheetsOpen, confirmSheet } from './ui/dom.js';
import * as S from './store.js';
import { invalidateCosts, handleWeekNav, selectedWeek, setWeek } from './ui/common.js';
import { renderHome, nextUnplannedWeek } from './ui/views/home.js';
import { renderRecipes, handleLibrary } from './ui/views/recipes.js';
import { renderRecipeDetail, setDetailServings, detailServings } from './ui/views/recipeDetail.js';
import { openRecipeForm } from './ui/views/recipeForm.js';
import { renderPlanning, handlePlanning, handlePlanningChange, openMealPicker } from './ui/views/planning.js';
import { renderShopping, handleShopping, handleQuickAdd } from './ui/views/shopping.js';
import { renderStock, handleStock, handleStockChange } from './ui/views/stock.js';
import { renderProducts, handleProducts } from './ui/views/products.js';
import { renderSettings, renderIngredients, handleSettings, handleSettingsChange, importRecipesFlow } from './ui/views/settings.js';
import { openIngredientSheet } from './ui/views/ingredientSheet.js';
import { photoURL } from './store.js';

const TABS = [
  ['accueil', '#/', 'home', 'Accueil'],
  ['recettes', '#/recettes', 'book', 'Recettes'],
  ['planning', '#/planning', 'calendar', 'Planning'],
  ['courses', '#/courses', 'cart', 'Courses'],
];

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (!parts.length) return { name: 'accueil', tab: 'accueil' };
  const [a, b, c] = parts;
  if (a === 'recettes') return { name: 'recettes', tab: 'recettes' };
  if (a === 'recette' && b === 'nouvelle') return { name: 'recette-nouvelle', tab: 'recettes' };
  if (a === 'recette' && c === 'modifier') return { name: 'recette-modifier', id: b, tab: 'recettes' };
  if (a === 'recette') return { name: 'recette', id: b, tab: 'recettes' };
  if (a === 'planning') return { name: 'planning', tab: 'planning' };
  if (a === 'courses') return { name: 'courses', tab: 'courses' };
  if (a === 'stock') return { name: 'stock', tab: 'accueil' };
  if (a === 'produits') return { name: 'produits', tab: 'accueil' };
  if (a === 'reglages') return { name: 'reglages', tab: 'accueil' };
  if (a === 'ingredients') return { name: 'ingredients', tab: 'accueil' };
  return { name: 'accueil', tab: 'accueil' };
}

function renderView(r) {
  switch (r.name) {
    case 'recettes': return renderRecipes();
    case 'recette': return renderRecipeDetail(r.id);
    case 'planning': return renderPlanning();
    case 'courses': return renderShopping();
    case 'stock': return renderStock();
    case 'produits': return renderProducts();
    case 'reglages': return renderSettings();
    case 'ingredients': return renderIngredients();
    default: return renderHome();
  }
}

let lastRoute = '';
let scheduled = false;
function render() {
  scheduled = false;
  const r = route();
  const view = $('#view');
  // Conserve le focus et la sélection d'un champ marqué data-keep / data-input.
  const ae = document.activeElement;
  const keep = ae && view.contains(ae) ? (ae.dataset.keep || ae.dataset.input) : null;
  const keepVal = keep ? ae.value : null;
  const sel = keep && ae.setSelectionRange ? [ae.selectionStart, ae.selectionEnd] : null;
  const key = location.hash;
  const sameRoute = key === lastRoute;
  const scroll = window.scrollY;

  view.innerHTML = String(renderView(r));
  view.dataset.route = r.name;
  document.body.dataset.route = r.name;
  for (const a of document.querySelectorAll('.tabbar a')) {
    const on = a.dataset.tab === r.tab;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (keep) {
    const el = view.querySelector(`[data-keep="${keep}"], [data-input="${keep}"]`);
    if (el) { el.value = keepVal; el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch { /* type search */ } }
  }
  if (sameRoute) window.scrollTo(0, scroll);
  else {
    lastRoute = key;
    const saved = (S.state.ui.scroll || {})[key];
    window.scrollTo(0, saved || 0);
    S.setUI({ lastHash: key }, { silent: true });
  }
  hydratePhotos(view);
}

export function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(render);
}

async function hydratePhotos(root) {
  for (const el of root.querySelectorAll('[data-photo]')) {
    const url = await photoURL(el.dataset.photo);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-photo'); }
  }
}

// --- Actions --------------------------------------------------------------------
async function onAction(action, el) {
  if (handleWeekNav(action)) return;
  if (handleLibrary(action, el)) return;
  switch (action) {
    case 'add-meal':
      if (route().name !== 'planning' || el.dataset.day == null) return openMealPicker({ day: el.dataset.day != null ? Number(el.dataset.day) : null, slot: el.dataset.slot || null });
      break;
    case 'plan-recipe': {
      const servings = el.dataset.servings ? Number(el.dataset.servings) : null;
      return openMealPicker({ recipeId: el.dataset.id, servings });
    }
    case 'new-week': {
      const id = nextUnplannedWeek();
      setWeek(id);
      await S.ensureWeek(id);
      location.hash = '#/planning';
      return;
    }
    case 'week-pick': setWeek(S.currentWeekId()); return;
    case 'detail-serv': {
      const r = route(); const rec = S.state.recipes.get(r.id);
      setDetailServings(r.id, detailServings(r.id, rec) + Number(el.dataset.d));
      return scheduleRender();
    }
    case 'recipe-dup': {
      const c = await S.duplicateRecipe(el.dataset.id);
      if (c) { toast('Recette dupliquée'); location.hash = `#/recette/${c.id}`; }
      return;
    }
    case 'recipe-del': {
      const r = S.state.recipes.get(el.dataset.id);
      const used = S.recipeUsage(r.id).length;
      const ok = await confirmSheet({
        title: `Supprimer « ${r.name} » ?`,
        message: used ? `Cette recette figure dans ${used} semaine(s). Elle sera retirée des semaines en cours et à venir ; l'historique des semaines passées est conservé.` : 'Cette action est définitive.',
        ok: 'Supprimer', danger: true,
      });
      if (!ok) return;
      await S.deleteRecipe(r.id);
      toast('Recette supprimée');
      location.hash = '#/recettes';
      return;
    }
    case 'ingredient-sheet': openIngredientSheet(el.dataset.id); return;
    case 'import-recipes': return importRecipesFlow();
  }
  if (await handlePlanning(action, el)) return;
  if (await handleShopping(action, el)) return;
  if (await handleStock(action, el)) return;
  if (await handleProducts(action, el)) return;
  if (await handleSettings(action, el)) return;
}

async function onChange(kind, el) {
  if (kind === 'hide-done') return S.setUI({ hideDone: el.checked });
  if (await handlePlanningChange(kind, el)) return;
  if (await handleStockChange(kind, el)) return;
  if (await handleSettingsChange(kind, el)) return;
}

function bindEvents() {
  const view = $('#view');
  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !view.contains(el)) return;
    e.preventDefault();
    try { await onAction(el.dataset.action, el); }
    catch (err) { console.error(err); toast('Erreur : ' + err.message, { tone: 'warn', ms: 6000 }); }
  });
  view.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    try { await onChange(el.dataset.change, el); }
    catch (err) { console.error(err); toast('Erreur : ' + err.message, { tone: 'warn' }); }
  });
  view.addEventListener('input', (e) => {
    const k = e.target.dataset.input;
    if (k === 'lib-q') S.setUI({ libQ: e.target.value });
    if (k === 'prod-q') S.setUI({ prodQ: e.target.value });
  });
  view.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-form="quick-add"]');
    if (!f) return;
    e.preventDefault();
    try { await handleQuickAdd(f); } catch (err) { toast(err.message, { tone: 'warn' }); }
  });

  window.addEventListener('hashchange', () => {
    // Retour arrière depuis une feuille ouverte : on ferme la feuille.
    const r = route();
    closeAllSheets();
    if (r.name === 'recette-nouvelle' || r.name === 'recette-modifier') {
      const back = r.name === 'recette-modifier' ? `#/recette/${r.id}` : (lastRoute || '#/recettes');
      history.replaceState(null, '', back);
      openRecipeForm(r.id || null, { onSaved: (rec) => { location.hash = `#/recette/${rec.id}`; } });
      scheduleRender();
      return;
    }
    scheduleRender();
  });
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const sc = { ...(S.state.ui.scroll || {}) }; sc[location.hash] = window.scrollY;
      S.setUI({ scroll: sc }, { silent: true });
    }, 300);
  }, { passive: true });
  window.addEventListener('popote:rerender', scheduleRender);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetsOpen()) closeTopSheet(); });
  // iOS peut geler l'app : on enregistre l'état d'interface dès qu'elle passe en arrière-plan.
  document.addEventListener('visibilitychange', () => { if (document.hidden) S.setUI({}, { immediate: true }); else scheduleRender(); });
  window.addEventListener('pagehide', () => S.setUI({}, { immediate: true }));
  window.addEventListener('online', () => document.body.classList.remove('offline'));
  window.addEventListener('offline', () => document.body.classList.add('offline'));
}

function tabbar() {
  $('#tabbar').innerHTML = TABS.map(([k, href, ic, label]) =>
    `<a href="${href}" data-tab="${k}"><svg class="ic" aria-hidden="true"><use href="#i-${ic}"/></svg><span>${label}</span></a>`).join('');
}

async function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Nouvelle version disponible. Vos données sont conservées.', { action: 'Mettre à jour', ms: 15000, onAction: () => { nw.postMessage('skipWaiting'); } });
        }
      });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  } catch (e) { console.warn('Service worker non enregistré', e); }
}

async function start() {
  tabbar();
  if (!navigator.onLine) document.body.classList.add('offline');
  try {
    await S.init();
  } catch (e) {
    $('#view').innerHTML = String(html`<div class="empty"><h2>Impossible d'ouvrir les données</h2><p>${e.message}</p><p>Vérifiez que la navigation privée est désactivée, puis rouvrez l'application.</p></div>`);
    return;
  }
  S.subscribe((what) => { if (what !== 'ui') invalidateCosts(); scheduleRender(); });
  bindEvents();
  // Restaure l'écran où l'on se trouvait (ex. liste de courses) si l'app a été fermée par iOS.
  if (!location.hash && /^#\/(courses|planning)$/.test(S.state.ui.lastHash || '')) history.replaceState(null, '', S.state.ui.lastHash);
  if (location.hash === '#/recette/nouvelle') { history.replaceState(null, '', '#/recettes'); openRecipeForm(null, { onSaved: (r) => { location.hash = `#/recette/${r.id}`; } }); }
  render();
  document.body.classList.add('ready');
  registerSW();
  // Demande un stockage persistant (accordé plus volontiers à une app installée).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* indisponible */ }
  window.__popote = { S, render, selectedWeek };
}

start();
