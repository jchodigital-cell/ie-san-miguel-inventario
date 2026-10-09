const CACHE_NAME = 'inventario-san-miguel-v6';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './jcho-logo.svg',
];
// Librerías externas para que Excel y PDF funcionen también SIN internet
const CDN_LIBS = [
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      // Las librerías no bloquean la instalación si el primer uso fue sin internet
      await Promise.allSettled(CDN_LIBS.map((url) => cache.add(url)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);

  // La nube (Firebase) nunca se cachea: el sistema guarda sus datos aparte
  if (requestUrl.hostname.includes('firebaseio.com') || requestUrl.hostname.includes('googleapis.com')) return;
  if (requestUrl.pathname.startsWith('/api/')) return;

  // Navegaciones: red primero, si no hay internet se sirve la app instalada
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Resto de archivos (incluidas librerías de Excel/PDF): red primero, caché de respaldo
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (requestUrl.hostname.includes('jsdelivr.net')) {
            return new Response('/* librería no disponible sin internet */', {
              status: 200,
              headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
            });
          }
          return caches.match('./index.html');
        })
      )
  );
});