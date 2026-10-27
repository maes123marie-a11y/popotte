import { html, icon, toast, confirmSheet, saveFile, pickFile, openSheet } from '../dom.js';
import { state, updateSettings, exportBackup, importBackup, markBackupDone, loadDemo, removeDemo, importRecipes, sortedIngredients, ingredientUsage, db } from '../../store.js';
import { parseRecipesCSV, parseRecipesJSON, toCSV } from '../../core/importexport.js';
import { unitLabel } from '../../core/units.js';
import { dateFR, empty } from '../common.js';
import { DEMO } from '../../demo.js';
import { openIngredientSheet } from './ingredientSheet.js';

export const APP_VERSION = '1.0.0';
let storageInfo = null;

async function refreshStorageInfo() {
  const info = { persisted: null, usage: null, quota: null, standalone: isStandalone() };
  try { if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted(); } catch { /* indisponible */ }
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); info.usage = e.usage; info.quota = e.quota; } } catch { /* indisponible */ }
  storageInfo = info;
}

export const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

const mb = (b) => b == null ? '?' : (b / 1048576).toLocaleString('fr-BE', { maximumFractionDigits: 1 }) + ' Mo';

export function renderSettings() {
  if (!storageInfo) refreshStorageInfo().then(() => window.dispatchEvent(new Event('popote:rerender')));
  const st = state.settings;
  const si = storageInfo || {};
  const n = { r: [...state.recipes.values()].filter(r => !r.deletedAt).length, p: state.products.size, w: [...state.weeks.values()].filter(w => w.entries.length).length };
  return html`
    <header class="page-head page-head-back">
      <a class="icon-btn" href="#/" aria-label="Retour">${icon('chev-left')}</a>
      <h1>Réglages</h1><span></span>
    </header>

    <section class="block card-flat">
      <h2 class="sec-title">${icon('shield')} Sauvegarde</h2>
      <p>Vos données (${n.r} recettes, ${n.p} produits, ${n.w} semaines) sont enregistrées uniquement sur cet iPhone.
      ${st.lastBackupAt ? `Dernière sauvegarde : ${dateFR(st.lastBackupAt, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : html`<strong>Aucune sauvegarde pour l'instant.</strong>`}</p>
      <div class="btn-col">
        <button type="button" class="btn btn-primary" data-action="backup">${icon('upload')} Sauvegarder toutes les données</button>
        <button type="button" class="btn" data-action="restore">${icon('download')} Restaurer une sauvegarde</button>
      </div>
      <p class="hint">Sur iPhone, choisissez « Enregistrer dans Fichiers » (iCloud Drive ou « Sur mon iPhone »). Pour restaurer, sélectionnez ce fichier : il remplace toutes les données actuelles.</p>
    </section>

    <section class="block card-flat">
      <h2 class="sec-title">Recettes</h2>
      <div class="btn-col">
        <button type="button" class="btn" data-action="import-recipes">Importer des recettes (JSON ou CSV)</button>
        <button type="button" class="btn" data-action="export-recipes-csv">Exporter les recettes (CSV)</button>
        <button type="button" class="btn" data-action="recipes-template">Télécharger un modèle CSV</button>
        <a class="btn" href="#/ingredients">Gérer les ingrédients</a>
      </div>
    </section>

    <section class="block card-flat">
      <h2 class="sec-title">Calculs</h2>
      <label class="switch"><input type="checkbox" data-change="set-optional" ${st.includeOptional ? 'checked' : ''}><span>Mettre les ingrédients facultatifs dans la liste de courses</span></label>
      <label class="switch"><input type="checkbox" data-change="set-stock" ${st.stockEnabled ? 'checked' : ''}><span>Déduire le stock de la liste de courses</span></label>
      <label class="field"><span>Un prix devient « ancien » après</span>
        <select data-change="set-stale">${[15, 30, 45, 60, 90, 180].map(d => html`<option value="${d}" ${st.staleDays === d ? 'selected' : ''}>${d} jours</option>`)}</select></label>
      <label class="field"><span>Enseignes préférées pour les prix (séparées par des virgules)</span>
        <input data-change="set-stores" value="${(st.preferredStores || []).join(', ')}"></label>
      <label class="field"><span>Rappel de sauvegarde</span>
        <select data-change="set-reminder">${[7, 14, 30, 9999].map(d => html`<option value="${d}" ${st.backupReminderDays === d ? 'selected' : ''}>${d === 9999 ? 'Jamais' : `Tous les ${d} jours`}</option>`)}</select></label>
    </section>

    <section class="block card-flat">
      <h2 class="sec-title">Exemples</h2>
      <p>Des recettes et produits d'exemple, marqués « Exemple », pour découvrir l'application. Leurs prix sont fictifs.</p>
      ${st.demoLoaded ? html`<button type="button" class="btn" data-action="demo-remove">Supprimer les exemples</button>`
        : html`<button type="button" class="btn" data-action="demo-load">Charger les exemples</button>`}
    </section>

    <section class="block card-flat">
      <h2 class="sec-title">Stockage sur l'appareil</h2>
      <ul class="kv">
        <li><span>Ouverte depuis l'écran d'accueil</span><strong>${si.standalone ? 'Oui' : 'Non'}</strong></li>
        <li><span>Stockage persistant accordé</span><strong>${si.persisted == null ? 'Inconnu' : si.persisted ? 'Oui' : 'Non'}</strong></li>
        <li><span>Espace utilisé</span><strong>${mb(si.usage)}</strong></li>
      </ul>
      ${!si.standalone ? html`<p class="banner banner-warn">Installez l'application : Safari, bouton Partager, puis « Sur l'écran d'accueil ». Les données de Safari et celles de l'application installée sont séparées.</p>` : ''}
      ${si.persisted === false ? html`<button type="button" class="btn btn-small" data-action="persist">Demander un stockage persistant</button>` : ''}
      <p class="hint">Supprimer l'icône de l'écran d'accueil efface les données de l'application. Faites une sauvegarde avant.</p>
    </section>

    <section class="block card-flat">
      <h2 class="sec-title">À propos</h2>
      <p>Popote ${APP_VERSION}. Fonctionne hors ligne, sans compte ni serveur. Prix : <a href="https://prices.openfoodfacts.org" target="_blank" rel="noopener">Open Prices</a> et <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (licence ODbL), uniquement lorsque vous lancez une recherche ou une actualisation.</p>
      <button type="button" class="btn btn-quiet danger-text" data-action="wipe">Effacer toutes les données</button>
    </section>`;
}

export function renderIngredients() {
  const list = sortedIngredients();
  return html`
    <header class="page-head page-head-back">
      <a class="icon-btn" href="#/reglages" aria-label="Retour">${icon('chev-left')}</a>
      <h1>Ingrédients</h1><span></span>
    </header>
    <p class="hint">Un ingrédient est partagé entre vos recettes. Deux ingrédients différents (oignon rouge, oignon jaune) restent séparés dans la liste de courses.</p>
    ${list.length ? html`<ul class="plist">${list.map(i => {
      const u = ingredientUsage(i.id);
      const priced = (i.productIds || []).length || i.manualPrice;
      return html`<li><button type="button" class="prow" data-action="ingredient-sheet" data-id="${i.id}">
        <span class="prow-main"><strong>${i.name}</strong><small>${i.category} · ${unitLabel(i.defaultUnit)} · ${u.recipes.length} recette(s)</small></span>
        <span class="prow-price">${priced ? html`<span class="tag tag-verifie">prix</span>` : html`<span class="tag tag-warn">sans prix</span>`}</span>
      </button></li>`;
    })}</ul>` : empty('tag', 'Aucun ingrédient', 'Les ingrédients sont créés quand vous ajoutez une recette.')}`;
}

export async function handleSettings(action, el) {
  switch (action) {
    case 'backup': {
      const data = await exportBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      const r = await saveFile(`popote-sauvegarde-${stamp}.json`, JSON.stringify(data), 'application/json');
      if (r !== 'cancelled') { await markBackupDone(); toast('Sauvegarde créée'); }
      return true;
    }
    case 'restore': {
      const f = await pickFile('application/json,.json');
      if (!f) return true;
      let obj;
      try { obj = JSON.parse(await f.text()); } catch { toast('Fichier illisible : ce n\'est pas une sauvegarde JSON.', { tone: 'warn' }); return true; }
      const recipes = obj && obj.data && obj.data.recipes ? obj.data.recipes.length : 0;
      const ok = await confirmSheet({
        title: 'Remplacer toutes les données ?',
        message: `La sauvegarde du ${dateFR(obj.exportedAt)} contient ${recipes} recette(s). Les données actuelles seront remplacées. Faites d'abord une sauvegarde si vous voulez les garder.`,
        ok: 'Restaurer', danger: true,
      });
      if (!ok) return true;
      try { await importBackup(obj); toast('Données restaurées'); }
      catch (e) { toast('Restauration refusée : ' + e.message, { tone: 'warn', ms: 8000 }); }
      return true;
    }
    case 'import-recipes': return importRecipesFlow();
    case 'export-recipes-csv': {
      const head = ['recette', 'portions', 'preparation_min', 'cuisson_min', 'categorie', 'ingredient', 'quantite', 'unite', 'facultatif', 'rayon', 'etapes', 'description', 'notes'];
      const rows = [head];
      for (const r of [...state.recipes.values()].filter(r => !r.deletedAt)) {
        const items = r.items.length ? r.items : [null];
        items.forEach((it, i) => {
          const ing = it && state.ingredients.get(it.ingredientId);
          rows.push([r.name, r.servings, r.prepMin, r.cookMin, r.category, ing ? ing.name : '', it ? String(it.qty).replace('.', ',') : '', it ? it.unit : '',
            it && it.optional ? 'oui' : '', ing ? ing.category : '', i === 0 ? (r.steps || []).join(' | ') : '', i === 0 ? r.description : '', i === 0 ? r.notes : '']);
        });
      }
      await saveFile('popote-recettes.csv', toCSV(rows), 'text/csv');
      return true;
    }
    case 'recipes-template': {
      const rows = [['recette', 'portions', 'preparation_min', 'cuisson_min', 'categorie', 'ingredient', 'quantite', 'unite', 'facultatif', 'rayon', 'etapes'],
        ['Stoemp aux carottes', 4, 20, 25, 'Végétarien', 'Pommes de terre', 1, 'kg', '', 'Fruits et légumes', 'Éplucher | Cuire 25 min | Écraser avec le beurre'],
        ['Stoemp aux carottes', 4, 20, 25, 'Végétarien', 'Carottes', 500, 'g', '', 'Fruits et légumes', ''],
        ['Stoemp aux carottes', 4, 20, 25, 'Végétarien', 'Beurre', 40, 'g', '', 'Produits laitiers', ''],
        ['Stoemp aux carottes', 4, 20, 25, 'Végétarien', 'Muscade', 1, 'pincee', 'oui', 'Épicerie sèche', '']];
      await saveFile('modele-recettes.csv', toCSV(rows), 'text/csv');
      return true;
    }
    case 'demo-load': await loadDemo(DEMO); toast('Exemples chargés'); return true;
    case 'demo-remove': {
      if (await confirmSheet({ title: 'Supprimer les exemples ?', message: 'Les recettes d\'exemple que vous avez modifiées sont conservées.', ok: 'Supprimer', danger: true })) {
        await removeDemo(); toast('Exemples supprimés');
      }
      return true;
    }
    case 'persist': {
      const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
      toast(ok ? 'Stockage persistant accordé' : 'iOS n\'a pas accordé le stockage persistant. Ouvrez l\'app depuis l\'écran d\'accueil et sauvegardez régulièrement.', { ms: 6000 });
      storageInfo = null;
      return true;
    }
    case 'wipe': {
      if (!(await confirmSheet({ title: 'Effacer toutes les données ?', message: 'Recettes, plannings, listes, stock et produits seront supprimés de cet iPhone. Cette action est irréversible.', ok: 'Continuer', danger: true }))) return true;
      if (!(await confirmSheet({ title: 'Vraiment tout effacer ?', ok: 'Tout effacer', danger: true }))) return true;
      await db.write(db.STORES.map(s => ({ store: s, clear: true })));
      location.reload();
      return true;
    }
  }
  return false;
}

export async function handleSettingsChange(kind, el) {
  const map = {
    'set-optional': () => updateSettings({ includeOptional: el.checked }),
    'set-stock': () => updateSettings({ stockEnabled: el.checked }),
    'set-stale': () => updateSettings({ staleDays: Number(el.value) }),
    'set-reminder': () => updateSettings({ backupReminderDays: Number(el.value) }),
    'set-stores': () => updateSettings({ preferredStores: el.value.split(',').map(s => s.trim()).filter(Boolean) }),
  };
  if (!map[kind]) return false;
  await map[kind]();
  if (kind === 'set-optional' || kind === 'set-stock') {
    const { syncList, isPastWeek } = await import('../../store.js');
    for (const w of [...state.weeks.values()]) if (!isPastWeek(w.id)) await syncList(w.id);
  }
  toast('Réglage enregistré');
  return true;
}

export async function importRecipesFlow() {
  const f = await pickFile('.json,.csv,application/json,text/csv,text/plain');
  if (!f) return true;
  const text = await f.text();
  const isJSON = /\.json$/i.test(f.name) || /^\s*[[{]/.test(text);
  const res = isJSON ? parseRecipesJSON(text) : parseRecipesCSV(text);
  if (!res.recipes.length) {
    openSheet(() => html`<h2 class="sheet-title">Import impossible</h2>
      <p class="sheet-text">Aucune recette valide dans ce fichier.</p>
      <ul class="errors">${res.errors.slice(0, 12).map(e => html`<li>${e}</li>`)}</ul>
      <button type="button" class="btn btn-block" data-close>Fermer</button>`);
    return true;
  }
  const names = res.recipes.map(r => r.name);
  const dup = names.filter(n => [...state.recipes.values()].some(r => !r.deletedAt && r.name.toLocaleLowerCase('fr') === n.toLocaleLowerCase('fr')));
  const ok = await confirmSheet({
    title: `Importer ${res.recipes.length} recette(s) ?`,
    message: [
      res.errors.length ? `${res.errors.length} problème(s) : ${res.errors.slice(0, 3).join(' ; ')}${res.errors.length > 3 ? '…' : ''}. Les recettes concernées seront ignorées.` : 'Toutes les recettes sont valides.',
      dup.length ? `Déjà présentes (seront ajoutées en double) : ${dup.join(', ')}.` : '',
      'Les ingrédients portant le même nom que les vôtres sont réutilisés.',
    ].filter(Boolean).join(' '),
    ok: 'Importer',
  });
  if (!ok) return true;
  const out = await importRecipes(res.recipes);
  toast(`${out.length} recette(s) importée(s)`);
  return true;
}

export { openIngredientSheet };
