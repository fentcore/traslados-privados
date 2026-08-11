// The admin app used to live at "/" and registered its service worker here,
// scoped to the whole site. It moved to /admin/ with its own service worker.
// This file now only exists to clean up that old root-scoped registration on
// any device that installed it before the move, so it stops intercepting
// requests to the new public landing page.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url)))
  );
});
