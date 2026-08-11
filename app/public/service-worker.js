// Kill switch: this file used to be the admin panel's service worker
// (root scope, "/"). The panel now lives at /admin and registers its own
// worker at /admin/service-worker.js. This one only exists so browsers that
// still have the old root-scoped worker installed detect the byte change,
// wipe every cache it created, and unregister themselves — instead of being
// stuck forever serving stale cached pages from a script that would
// otherwise just 404.
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
