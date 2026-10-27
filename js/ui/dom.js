// Petits utilitaires d'interface : gabarits échappés, feuilles modales, toasts.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));

// html`...` : toute valeur interpolée est échappée, sauf raw() et les tableaux de raw.
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += fmt(v) + strings[i + 1]; });
  return raw(out);
}
function fmt(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
}

// --- Toast ----------------------------------------------------------------------
let toastTimer;
export function toast(msg, { action, onAction, ms = 3200, tone = '' } = {}) {
  let el = $('#toast');
  el.className = `toast show ${tone}`;
  el.innerHTML = html`<span>${msg}</span>${action ? html`<button type="button" class="toast-act">${action}</button>` : ''}`.s;
  if (action) $('.toast-act', el).onclick = () => { el.className = 'toast'; onAction && onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

// --- Feuilles (modales en bas d'écran) ----------------------------------------
const stack = [];

export function openSheet(render, { onClose, full = false, label = 'Fenêtre' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div><section class="sheet ${full ? 'sheet-full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sheet-grip" aria-hidden="true"></div><div class="sheet-body"></div></section>`;
  document.body.appendChild(wrap);
  const body = $('.sheet-body', wrap);
  const api = {
    el: body, wrap,
    render() { const r = render(api); if (r != null) body.innerHTML = String(r); },
    close(result) {
      if (api.closed) return;
      api.closed = true;
      wrap.classList.remove('open');
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      setTimeout(() => wrap.remove(), 220);
      document.body.classList.toggle('has-sheet', stack.length > 0);
      onClose && onClose(result);
    },
  };
  wrap.addEventListener('click', (e) => { if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) api.close(); });
  stack.push(api);
  document.body.classList.add('has-sheet');
  api.render();
  requestAnimationFrame(() => wrap.classList.add('open'));
  return api;
}

export function closeTopSheet() { const s = stack[stack.length - 1]; if (s) { s.close(); return true; } return false; }
export function closeAllSheets() { while (stack.length) stack[stack.length - 1].close(); }
export function sheetsOpen() { return stack.length; }

export function confirmSheet({ title, message = '', ok = 'Confirmer', cancel = 'Annuler', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const s = openSheet(() => html`
      <h2 class="sheet-title">${title}</h2>
      ${message ? html`<p class="sheet-text">${message}</p>` : ''}
      <div class="sheet-actions">
        ${extra ? html`<button type="button" class="btn" data-r="extra">${extra}</button>` : ''}
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="ok">${ok}</button>
        <button type="button" class="btn btn-quiet" data-r="cancel">${cancel}</button>
      </div>`, { onClose: (r) => resolve(r ?? false), label: title });
    s.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      s.close(b.dataset.r === 'ok' ? true : b.dataset.r === 'extra' ? 'extra' : false);
    });
  });
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

// Redimensionne une photo (JPEG, côté max 1200 px) avant stockage local.
export async function resizeImage(file, max = 1200, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(res => c.toBlob(b => res(b || file), 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}

// Partage ou téléchargement d'un fichier (iOS : feuille de partage → « Enregistrer dans Fichiers »).
export async function saveFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files && i.files[0] || null);
    i.click();
  });
}
