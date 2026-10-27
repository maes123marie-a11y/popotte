// Service worker : met toute l'application en cache pour un usage hors ligne.
// Les données (IndexedDB) ne sont jamais touchées par une mise à jour.
// Les requêtes vers Open Prices / Open Food Facts passent toujours par le réseau.
const VERSION = '69dcd654c485';
const CACHE = `popote-${VERSION}`;
const ASSETS = [
  './',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512-maskable.png',
  './icons/icon-512.png',
  './index.html',
  './js/app.js',
  './js/core/budget.js',
  './js/core/costing.js',
  './js/core/importexport.js',
  './js/core/money.js',
  './js/core/packaging.js',
  './js/core/priceupdate.js',
  './js/core/shopping.js',
  './js/core/stock.js',
  './js/core/units.js',
  './js/core/week.js',
  './js/db.js',
  './js/demo.js',
  './js/prices.js',
  './js/store.js',
  './js/ui/common.js',
  './js/ui/dom.js',
  './js/ui/scanner.js',
  './js/ui/views/home.js',
  './js/ui/views/ingredientSheet.js',
  './js/ui/views/planning.js',
  './js/ui/views/products.js',
  './js/ui/views/recipeDetail.js',
  './js/ui/views/recipeForm.js',
  './js/ui/views/recipes.js',
  './js/ui/views/settings.js',
  './js/ui/views/shopping.js',
  './js/ui/views/stock.js',
  './manifest.webmanifest',
  './vendor/zxing.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('popote-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API externes : réseau uniquement
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    try {
      return await fetch(req);
    } catch (e) {
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
