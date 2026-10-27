// Lecture de code-barres avec la caméra. iOS Safari ne fournit pas
// BarcodeDetector : on charge la bibliothèque ZXing embarquée (hors ligne).
import { html, openSheet, $, toast } from './dom.js';

export const scannerSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

let zxingLoading = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoading) zxingLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = './vendor/zxing.min.js';
    s.onload = () => res(window.ZXing);
    s.onerror = () => rej(new Error('Lecteur de code-barres indisponible'));
    document.head.appendChild(s);
  });
  return zxingLoading;
}

export function scanBarcode() {
  return new Promise((resolve) => {
    let reader = null, stream = null, done = false, detectTimer = null;
    const finish = (code) => {
      if (done) return; done = true;
      clearInterval(detectTimer);
      try { reader && reader.reset(); } catch { /* rien */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      sheet.close();
      resolve(code || null);
    };
    const sheet = openSheet(() => html`
      <h2 class="sheet-title">Scanner un code-barres</h2>
      <div class="scan-box"><video playsinline muted autoplay></video><div class="scan-line"></div></div>
      <p class="sheet-text" data-msg>Placez le code-barres dans le cadre.</p>
      <button type="button" class="btn btn-block" data-close>Annuler</button>`, { label: 'Scanner', onClose: () => finish(null) });
    const video = $('video', sheet.el);
    const msg = $('[data-msg]', sheet.el);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        if ('BarcodeDetector' in window) {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
          detectTimer = setInterval(async () => {
            try { const r = await det.detect(video); if (r && r[0]) finish(r[0].rawValue); } catch { /* image suivante */ }
          }, 250);
          return;
        }
        const ZX = await loadZXing();
        const hints = new Map();
        hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E]);
        reader = new ZX.BrowserMultiFormatReader(hints, 300);
        reader.decodeFromStream(stream, video, (result) => { if (result) finish(result.getText()); });
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError'
          ? 'Accès à la caméra refusé. Autorisez-le dans Réglages > Safari > Caméra, ou tapez le code.'
          : `Caméra indisponible : ${e.message || e}. Tapez le code à la main.`;
        toast('Scanner indisponible', { tone: 'warn' });
      }
    })();
  });
}
