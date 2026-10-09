/* Service worker do Repertório Haroldo — cache offline do app.
   IMPORTANTE: sempre que o repertorio-haroldo.html for atualizado,
   troque o número da CACHE_VERSION abaixo para forçar a atualização
   nos celulares que já têm o app instalado. */
const CACHE_VERSION = 'v12';
const CACHE_NAME = 'repertorio-haroldo-' + CACHE_VERSION;
const ASSETS = [
  './repertorio-haroldo.html',
  './manifest.json',
  './icon.svg',
  './setlist.html',
  './musicos.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        if (res && res.status === 200){
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
