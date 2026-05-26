const STATIC_CACHE = 'zahlung-static-v8';
const RUNTIME_CACHE = 'zahlung-runtime-v8';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
      .map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_RUNTIME_CACHE') {
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== location.origin || request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url.pathname)) event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/offline.html')))
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});

function isCacheableApi(pathname) {
  return ['/api/dashboard', '/api/payments', '/api/tenants', '/api/categories', '/api/meta'].some((prefix) => pathname.startsWith(prefix));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline und keine zwischengespeicherten Daten vorhanden.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
