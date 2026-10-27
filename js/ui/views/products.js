import { html, icon, openSheet, $, toast, confirmSheet, saveFile, pickFile } from '../dom.js';
import { state, saveProduct, deleteProduct, ingredientsForProduct, setUI, importProducts, updateSettings } from '../../store.js';
import { normalizeUnit, formatQty } from '../../core/units.js';
import { parseAmount, parseQty } from '../../core/money.js';
import { priceStatus } from '../../core/costing.js';
import { parseProductsCSV, toCSV } from '../../core/importexport.js';
import { unitOptions, categoryOptions, formatEUR, statusTag, refPriceLabel, dateFR, empty } from '../common.js';
import { lookupProduct, bestPriceFor, refreshAll, refreshProduct, cleanBarcode, fetchObservations } from '../../prices.js';
import { scanBarcode, scannerSupported } from '../scanner.js';

const STORES = ['Colruyt', 'Intermarché', 'Delhaize', 'Carrefour', 'Aldi', 'Lidl', 'Albert Heijn', 'Spar', 'Okay'];

export function renderProducts() {
  const filter = state.ui.prodFilter || 'tous';
  const q = (state.ui.prodQ || '').toLocaleLowerCase('fr');
  const all = [...state.products.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const st = (p) => priceStatus(p, Date.now(), state.settings.staleDays);
  const counts = { tous: all.length, ancien: 0, indisponible: 0, manuel: 0, verifie: 0 };
  for (const p of all) counts[st(p)]++;
  let list = filter === 'tous' ? all : all.filter(p => st(p) === filter);
  if (q) list = list.filter(p => `${p.name} ${p.brand} ${p.store} ${p.barcode}`.toLocaleLowerCase('fr').includes(q));
  const last = state.settings.lastPriceRefresh;
  const withCode = all.filter(p => p.barcode && !p.demo).length;
  return html`
    <header class="page-head page-head-back">
      <a class="icon-btn" href="#/" aria-label="Retour">${icon('chev-left')}</a>
      <h1>Produits et prix</h1>
      <div class="head-actions">
        <button type="button" class="icon-btn" data-action="prod-menu" aria-label="Importer ou exporter">${icon('download')}</button>
        <button type="button" class="icon-btn icon-btn-primary" data-action="prod-new" aria-label="Nouveau produit">${icon('plus')}</button>
      </div>
    </header>
    <section class="refresh-box">
      <div>
        <strong>Prix Open Prices</strong>
        <p>${last ? `Dernière actualisation : ${dateFR(last, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Jamais actualisés'}.
        ${withCode} produit${withCode > 1 ? 's' : ''} avec code-barres.</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="prices-refresh" ${withCode ? '' : 'disabled'}>${icon('refresh')} Actualiser les prix</button>
    </section>
    <p class="hint">Les prix viennent de relevés publics (Open Food Facts), par code-barres, filtrés sur la Belgique et votre enseigne. Les prix Colruyt varient d'un magasin à l'autre : un relevé reste une estimation.</p>
    <label class="search">${icon('search')}<input type="search" placeholder="Rechercher un produit" value="${state.ui.prodQ || ''}" data-input="prod-q"></label>
    <div class="chips">
      ${[['tous', 'Tous'], ['verifie', 'Vérifiés'], ['ancien', 'Anciens'], ['manuel', 'Manuels'], ['indisponible', 'Sans prix']].map(([k, l]) =>
        html`<button type="button" class="chip ${filter === k ? 'on' : ''}" data-action="prod-filter" data-v="${k}">${l} <small>${counts[k]}</small></button>`)}
    </div>
    ${list.length ? html`<ul class="plist">${list.map(p => html`<li>
      <button type="button" class="prow" data-action="prod-edit" data-id="${p.id}">
        <span class="prow-main"><strong>${p.name}</strong>
          <small>${[p.brand, p.store, formatQty(p.packQty, p.packUnit), p.soldByWeight ? 'au détail' : ''].filter(Boolean).join(' · ')}</small>
          <small>${ingredientsForProduct(p.id).map(i => i.name).join(', ') || 'Non associé'}${p.priceDate ? ` · prix du ${dateFR(p.priceDate)}` : ''}${p.demo ? ' · exemple (prix fictif)' : ''}</small></span>
        <span class="prow-price"><strong>${p.packPrice != null ? formatEUR(p.packPrice) : '—'}</strong><small>${refPriceLabel(p)}</small>${statusTag(p)}</span>
      </button></li>`)}</ul>`
    : empty('tag', all.length ? 'Aucun produit dans ce filtre' : 'Aucun produit', 'Ajoutez un produit avec son code-barres pour récupérer un prix, ou importez un catalogue CSV.',
      html`<button type="button" class="btn btn-primary" data-action="prod-new">Ajouter un produit</button>`)}`;
}

export async function handleProducts(action, el) {
  if (action === 'prod-filter') setUI({ prodFilter: el.dataset.v });
  else if (action === 'prod-new') openProductForm(null);
  else if (action === 'prod-edit') openProductForm(el.dataset.id);
  else if (action === 'prices-refresh') await runRefresh(el);
  else if (action === 'prod-menu') productMenu();
  else return false;
  return true;
}

async function runRefresh(btn) {
  btn.disabled = true;
  const label = btn.innerHTML;
  try {
    const r = await refreshAll((i, n) => { btn.textContent = `Actualisation ${i}/${n}…`; });
    await updateSettings({ lastPriceRefresh: new Date().toISOString() });
    const parts = [`${r.update} mis à jour`, `${r.unchanged} inchangés`];
    if (r.older) parts.push(`${r.older} relevés plus anciens ignorés`);
    if (r.notfound) parts.push(`${r.notfound} sans relevé en Belgique`);
    if (r.error) parts.push(`${r.error} en erreur`);
    toast(parts.join(', ') + '.', { ms: 7000, tone: r.error ? 'warn' : '' });
    if (r.errors.length) console.warn(r.errors);
  } catch (e) {
    toast('Actualisation impossible : ' + e.message, { tone: 'warn', ms: 6000 });
  } finally { btn.disabled = false; btn.innerHTML = label; }
}

function productMenu() {
  const s = openSheet(() => html`
    <h2 class="sheet-title">Catalogue de produits</h2>
    <p class="sheet-text">Format CSV (séparateur ; ou ,) : nom; marque; enseigne; code_barres; rayon; contenance; unite; prix; date_prix (AAAA-MM-JJ); source; url; vrac; zone; ingredient.</p>
    <div class="sheet-actions">
      <button type="button" class="btn btn-primary" data-m="import">Importer un CSV</button>
      <button type="button" class="btn" data-m="export">Exporter le catalogue (CSV)</button>
      <button type="button" class="btn" data-m="template">Télécharger un modèle</button>
      <button type="button" class="btn" data-m="test">Tester l'accès aux prix en ligne</button>
      <button type="button" class="btn btn-quiet" data-close>Fermer</button>
    </div>`, { label: 'Catalogue' });
  s.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]');
    const m = b?.dataset.m;
    if (!m) return;
    if (m === 'export' || m === 'template') {
      const head = ['nom', 'marque', 'enseigne', 'code_barres', 'rayon', 'contenance', 'unite', 'prix', 'date_prix', 'source', 'url', 'vrac', 'zone', 'ingredient'];
      const rows = m === 'template'
        ? [head, ['Riz basmati 1 kg', 'Boni', 'Colruyt', '', 'Épicerie sèche', '1', 'kg', '2,49', '2026-10-27', 'ticket de caisse', '', '', 'Ans', 'Riz']]
        : [head, ...[...state.products.values()].map(p => [p.name, p.brand, p.store, p.barcode, p.category, p.packQty, p.packUnit,
          p.packPrice != null ? String(p.packPrice).replace('.', ',') : '', p.priceDate ? p.priceDate.slice(0, 10) : '', p.priceSource || '', p.url || '',
          p.soldByWeight ? 'oui' : '', p.zone || '', ingredientsForProduct(p.id).map(i => i.name)[0] || ''])];
      await saveFile(m === 'template' ? 'modele-catalogue.csv' : 'popote-catalogue.csv', toCSV(rows), 'text/csv');
    }
    if (m === 'test') {
      b.disabled = true; b.textContent = 'Test en cours…';
      const out = [];
      try { const items = await fetchObservations('3017620422003'); out.push(`Open Prices : accessible (${items.length} relevés reçus pour un produit test).`); }
      catch (err) { out.push(`Open Prices : ${err.message}.`); }
      try { const info = await lookupProduct('3017620422003'); out.push(`Open Food Facts : ${info ? 'accessible' : 'réponse vide'}.`); }
      catch (err) { out.push(`Open Food Facts : ${err.message}.`); }
      b.disabled = false; b.textContent = "Tester l'accès aux prix en ligne";
      toast(out.join(' '), { ms: 9000 });
      return;
    }
    if (m === 'import') {
      const f = await pickFile('.csv,text/csv,text/plain');
      if (!f) return;
      const res = parseProductsCSV(await f.text());
      s.close();
      if (!res.products.length) { toast(`Aucun produit valide. ${res.errors.slice(0, 2).join(' ; ')}`, { tone: 'warn', ms: 8000 }); return; }
      const ok = await confirmSheet({
        title: `Importer ${res.products.length} produit(s) ?`,
        message: res.errors.length ? `${res.errors.length} ligne(s) ignorée(s) : ${res.errors.slice(0, 4).join(' ; ')}` : 'Toutes les lignes sont valides. Un prix plus récent déjà enregistré ne sera pas remplacé.',
        ok: 'Importer',
      });
      if (!ok) return;
      const r = await importProducts(res.products);
      toast(`${r.count} produit(s) importé(s), ${r.linked} associé(s) à un ingrédient.`);
    }
  });
}

export function openProductForm(id, { linkIngredientId = null, defaults = {}, onClose } = {}) {
  const src = id ? state.products.get(id) : null;
  const p = src ? { ...src } : {
    name: '', brand: '', store: state.settings.preferredStores?.[0] || 'Colruyt', barcode: '', category: 'Autres',
    packQty: 1, packUnit: 'kg', packPrice: null, soldByWeight: false, lot: 1, available: true,
    priceDate: null, priceSource: null, url: '', zone: '', autoUpdate: true, ...defaults,
  };
  if (!normalizeUnit(p.packUnit)) p.packUnit = 'g';
  let found = null, busy = false;

  const sheet = openSheet(() => html`
    <form class="form" novalidate>
      <header class="sheet-head">
        <button type="button" class="btn btn-quiet" data-close>Annuler</button>
        <h2>${src ? 'Produit' : 'Nouveau produit'}</h2>
        <button type="submit" class="btn btn-primary btn-small">Enregistrer</button>
      </header>
      ${src && src.demo ? html`<p class="banner banner-warn">Produit d'exemple : son prix est fictif.</p>` : ''}
      <div class="field"><span>Code-barres (EAN)</span>
        <div class="input-row">
          <input name="barcode" inputmode="numeric" value="${p.barcode}" placeholder="5400…" autocomplete="off">
          ${scannerSupported() ? html`<button type="button" class="icon-btn" data-p="scan" aria-label="Scanner">${icon('scan')}</button>` : ''}
          <button type="button" class="btn btn-small" data-p="lookup" ${busy ? 'disabled' : ''}>${busy ? 'Recherche…' : 'Rechercher'}</button>
        </div></div>
      <div data-slot="found">${foundBox(found)}</div>
      <label class="field"><span>Nom commercial</span><input name="name" value="${p.name}" required></label>
      <div class="row2">
        <label class="field"><span>Marque</span><input name="brand" value="${p.brand}"></label>
        <label class="field"><span>Enseigne</span><input name="store" value="${p.store}" list="stores-dl"></label>
      </div>
      <datalist id="stores-dl">${STORES.map(s => html`<option value="${s}">`)}</datalist>
      <label class="field"><span>Rayon</span><select name="category">${categoryOptions(p.category)}</select></label>
      <div class="row3">
        <label class="field"><span>Contenance</span><input name="packQty" inputmode="decimal" value="${String(p.packQty ?? '').replace('.', ',')}"></label>
        <label class="field"><span>Unité</span><select name="packUnit">${unitOptions(p.packUnit)}</select></label>
        <label class="field"><span>Prix (€)</span><input name="packPrice" inputmode="decimal" value="${p.packPrice != null ? String(p.packPrice).replace('.', ',') : ''}" placeholder="inconnu"></label>
      </div>
      <label class="check"><input type="checkbox" name="soldByWeight" ${p.soldByWeight ? 'checked' : ''}> Vendu au poids ou au détail (vrac, fruits et légumes) : on paie la quantité exacte</label>
      <div class="row2">
        <label class="field"><span>Vendu par lot de</span><input name="lot" type="number" min="1" inputmode="numeric" value="${p.lot || 1}"></label>
        <label class="field"><span>Date du prix</span><input name="priceDate" type="date" value="${p.priceDate ? p.priceDate.slice(0, 10) : ''}"></label>
      </div>
      <label class="check"><input type="checkbox" name="available" ${p.available !== false ? 'checked' : ''}> Disponible en magasin</label>
      <label class="check"><input type="checkbox" name="autoUpdate" ${p.autoUpdate !== false ? 'checked' : ''}> Actualiser ce prix depuis Open Prices (nécessite le code-barres)</label>
      <div class="row2">
        <label class="field"><span>Magasin / zone</span><input name="zone" value="${p.zone || ''}" placeholder="ex. Colruyt Ans"></label>
        <label class="field"><span>Fiche produit (URL)</span><input name="url" type="url" value="${p.url || ''}" placeholder="https://"></label>
      </div>
      ${src ? html`<p class="hint">Source du prix : ${src.priceSource || '—'}${src.priceNote ? ` (${src.priceNote})` : ''}. ${statusTag(src)}
        ${src.lastCheckedAt ? html`<br>Dernière vérification : ${dateFR(src.lastCheckedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${checkLabel(src.lastCheckResult)})` : ''}</p>
        ${src.priceHistory && src.priceHistory.length ? html`<details><summary>Historique des prix</summary><ul class="hist">${src.priceHistory.slice().reverse().map(h => html`<li>${h.price != null ? formatEUR(h.price) : '—'} · ${dateFR(h.date)} · ${h.source || ''}</li>`)}</ul></details>` : ''}
        ${src.url ? html`<p><a href="${src.url}" target="_blank" rel="noopener">Ouvrir la fiche produit</a></p>` : ''}
        <div class="btn-row">${src.barcode ? html`<button type="button" class="btn btn-small" data-p="refresh">${icon('refresh')} Actualiser ce prix</button>` : ''}
        <button type="button" class="btn btn-small danger-text" data-p="delete">Supprimer le produit</button></div>` : ''}
    </form>`, { full: true, label: 'Produit', onClose });

  const root = sheet.el;
  const form = $('form', root);
  const fill = (k, v) => { const el = form.elements[k]; if (el && v != null && v !== '') el.value = String(v).replace(/^(\d+)\.(\d+)$/, '$1,$2'); };

  async function lookup() {
    const code = cleanBarcode(form.elements.barcode.value);
    if (code.length < 8) { toast('Code-barres trop court.'); return; }
    busy = true; $('[data-p="lookup"]', root).textContent = 'Recherche…';
    const out = { code };
    try {
      const [info, pick] = await Promise.allSettled([lookupProduct(code), bestPriceFor(code, form.elements.store.value)]);
      out.info = info.status === 'fulfilled' ? info.value : null;
      out.infoErr = info.status === 'rejected' ? info.reason.message : null;
      out.pick = pick.status === 'fulfilled' ? pick.value : null;
      out.pickErr = pick.status === 'rejected' ? pick.reason.message : null;
      if (out.info) {
        if (!form.elements.name.value) fill('name', out.info.name);
        if (!form.elements.brand.value) fill('brand', out.info.brand);
        if (out.info.packQty) { fill('packQty', out.info.packQty); form.elements.packUnit.value = normalizeUnit(out.info.packUnit) || form.elements.packUnit.value; }
        if (!form.elements.url.value) fill('url', out.info.url);
      }
    } finally {
      busy = false; found = out;
      $('[data-slot="found"]', root).innerHTML = foundBox(found).s;
      const b = $('[data-p="lookup"]', root); if (b) b.textContent = 'Rechercher';
    }
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const a = b.dataset.p;
    if (a === 'lookup') lookup();
    else if (a === 'scan') {
      const code = await scanBarcode();
      if (code) { form.elements.barcode.value = code; lookup(); }
    } else if (a === 'use-price' && found && found.pick && found.pick.best) {
      const o = found.pick.best;
      if (o.per === 'UNIT') fill('packPrice', o.price);
      else { toast('Relevé au kilo : vérifiez la contenance.'); fill('packPrice', o.price * (parseQty(form.elements.packQty.value) || 1)); }
      form.elements.priceDate.value = o.date;
      p.priceSource = 'Open Prices';
      p.priceNote = `${o.storeName}${o.city ? ' (' + o.city + ')' : ''}${o.discounted ? ' · promo' : ''}${o.storeMatched ? '' : ' · autre enseigne'}`;
      p._fromOpenPrices = true;
      toast('Prix repris du relevé Open Prices');
    } else if (a === 'refresh') {
      try {
        const r = await refreshProduct(state.products.get(id));
        toast({ update: 'Prix mis à jour', unchanged: 'Prix inchangé', older: 'Relevé plus ancien que votre prix : conservé', notfound: 'Aucun relevé en Belgique pour ce produit', 'skip-manual': 'Prix manuel conservé (actualisation désactivée)', incompatible: 'Relevé incompatible avec la contenance' }[r.action] || r.action);
        sheet.close();
      } catch (err) { toast('Actualisation impossible : ' + err.message, { tone: 'warn' }); }
    } else if (a === 'delete') {
      if (await confirmSheet({ title: 'Supprimer ce produit ?', message: 'Il sera dissocié des ingrédients.', ok: 'Supprimer', danger: true })) {
        await deleteProduct(id); sheet.close(); toast('Produit supprimé');
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const name = f.name.value.trim();
    const packQty = parseQty(f.packQty.value);
    const price = parseAmount(f.packPrice.value);
    const errs = [];
    if (!name) errs.push('le nom');
    if (!(packQty > 0)) errs.push('la contenance');
    if (Number.isNaN(price)) errs.push('le prix');
    if (errs.length) { toast(`Vérifiez ${errs.join(', ')}.`, { tone: 'warn' }); return; }
    const priceChanged = !src || src.packPrice !== price;
    let priceSource = p.priceSource, priceNote = p.priceNote;
    if (priceChanged && !p._fromOpenPrices) { priceSource = price == null ? null : 'manuel'; priceNote = ''; }
    const dateVal = f.priceDate.value;
    const out = {
      ...p, name, brand: f.brand.value.trim(), store: f.store.value.trim(), barcode: cleanBarcode(f.barcode.value),
      category: f.category.value, packQty, packUnit: normalizeUnit(f.packUnit.value), packPrice: price,
      soldByWeight: f.soldByWeight.checked, lot: Math.max(1, Number(f.lot.value) || 1), available: f.available.checked,
      autoUpdate: f.autoUpdate.checked, zone: f.zone.value.trim(), url: f.url.value.trim(),
      priceDate: price == null ? null : (dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : (priceChanged ? new Date().toISOString() : p.priceDate)),
      priceSource, priceNote, demo: src ? (src.demo && !priceChanged) : false,
    };
    delete out._fromOpenPrices;
    const saved = await saveProduct(out, { linkIngredientId });
    toast(src ? 'Produit enregistré' : 'Produit ajouté');
    sheet.close(saved);
  });
  return sheet;
}

function checkLabel(r) {
  return { update: 'mis à jour', unchanged: 'inchangé', older: 'relevé plus ancien ignoré', notfound: 'aucun relevé', 'skip-manual': 'prix manuel conservé', incompatible: 'incompatible' }[r] || r || '';
}

function foundBox(f) {
  if (!f) return html``;
  const parts = [];
  if (f.info) parts.push(html`<p>${icon('check')} Fiche trouvée sur Open Food Facts : <strong>${f.info.name || 'sans nom'}</strong>${f.info.brand ? ` (${f.info.brand})` : ''}${f.info.packQty ? `, ${f.info.packQty} ${f.info.packUnit}` : ''}.</p>`);
  else if (f.infoErr) parts.push(html`<p>Fiche produit : ${f.infoErr}.</p>`);
  else parts.push(html`<p>Produit inconnu d'Open Food Facts.</p>`);
  if (f.pick && f.pick.best) {
    const o = f.pick.best;
    parts.push(html`<p><strong>${formatEUR(o.price)}</strong>${o.per !== 'UNIT' ? ` / ${o.per === 'KILOGRAM' ? 'kg' : 'l'}` : ''} relevé le ${dateFR(o.date)} chez ${o.storeName || 'un magasin'}${o.city ? ` (${o.city})` : ''}${o.discounted ? ', en promotion' : ''}.
      ${!o.storeMatched ? html`<br><em>Aucun relevé pour cette enseigne : prix d'une autre enseigne en Belgique.</em>` : ''}</p>
      <button type="button" class="btn btn-small" data-p="use-price">Utiliser ce prix</button>`);
  } else if (f.pickErr) parts.push(html`<p>Prix : ${f.pickErr}. Vous pouvez saisir le prix manuellement.</p>`);
  else parts.push(html`<p>Aucun prix relevé en Belgique pour ce code-barres. Saisissez le prix du ticket ou de l'étiquette.</p>`);
  return html`<div class="found">${parts}</div>`;
}
