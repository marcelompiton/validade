const CACHE_NAME = 'validade-v27';
const ASSETS = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match('./index.html'))
  ));
});

// Push event handler
self.addEventListener('push', e => {
  let data = { title: '🥦 Validade', body: 'Confira seus itens!', url: '/' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; } catch (_) {
      data.body = e.data.text();
    }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '🥦',
      badge: '⚠️',
      tag: data.tag || 'validade-push',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200]
    })
  );
});

// Notification click — open the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url ? e.notification.data.url : '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('validade') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Legacy message handler
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CHECK_EXPIRY') {
    const items = e.data.items || [];
    const today = new Date().toISOString().split('T')[0];
    const expiring = items.filter(i => i.status === 'active' && i.expiryDate === today);
    if (expiring.length > 0) {
      self.registration.showNotification('⚠️ Validade', {
        body: `${expiring.length} item(ns) vencem hoje: ${expiring.map(i=>i.name).join(', ')}`,
        icon: '🥦',
        badge: '⚠️',
        tag: 'expiry-today',
        data: { url: '/' },
        vibrate: [200, 100, 200]
      });
    }
  }
});
