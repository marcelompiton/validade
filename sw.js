const CACHE_NAME = 'validade-v1';
const ASSETS = ['/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.status === 200 && e.request.method === 'GET') {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
    }
    return resp;
  }).catch(() => caches.match('/index.html'))));
});

// Notification scheduling
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_EXPIRY') {
    const items = e.data.items || [];
    const today = new Date().toISOString().split('T')[0];
    const expiring = items.filter(i => i.status === 'active' && i.expiryDate === today);
    if (expiring.length > 0) {
      self.registration.showNotification('⚠️ Validade', {
        body: `${expiring.length} item(ns) vencem hoje!`,
        icon: '🥦',
        badge: '⚠️',
        tag: 'expiry-today'
      });
    }
  }
});
