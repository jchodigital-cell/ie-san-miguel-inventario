/* ============================================================================
   Service Worker - IE San Miguel Inventario General
   Funcionamiento offline y caché de recursos estáticos
   ============================================================================ */

const CACHE_NAME = 'ie-san-miguel-inventario-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/socket.io/socket.io.js',
];

// Instalación: cachear recursos estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW: Algunos recursos no se cachearon:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activación: limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar peticiones: estrategia "Cache First" para estáticos, "Network First" para API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Recursos estáticos: Cache First
  if (STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/socket.io/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  // API: Network First con fallback a cache (offline)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clonar y guardar en cache si es GET exitoso
          if (event.request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Demás: Network First
  event.respondWith(fetch(event.request));
});

// Sincronización en segundo plano (opcional para futuras mejoras)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-inventario') {
    event.waitUntil(syncPendingChanges());
  }
});

async function syncPendingChanges() {
  // Placeholder para sincronización de cambios pendientes offline
  console.log('SW: Sincronizando cambios pendientes...');
}
