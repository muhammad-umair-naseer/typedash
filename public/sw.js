/* TypeDash service worker: makes the game installable and fast to reopen.
 * - navigations: network first, falling back to the cached shell when offline
 * - the app's code (css/js): network first, so a reload can never boot stale code
 * - icons and fonts: stale-while-revalidate, for speed and offline use
 * - never caches /api, /og, /r or the socket
 * Push notifications (streak reminders) are handled at the bottom. */
const CACHE = 'typedash-v4';
const SHELL = ['/', '/app', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isAsset = (url) => /^\/(css|js|icons|fonts)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest';
const never = (url) => /^\/(api|og|r)\//.test(url.pathname) || url.pathname === '/sw.js';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || never(url)) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && (url.pathname === '/' || url.pathname === '/app')) caches.open(CACHE).then((c) => c.put(url.pathname, res.clone()));
      return res;
    }).catch(() => caches.match(url.pathname === '/app' ? '/app' : '/')));
    return;
  }
  if (isAsset(url)) {
    // The app's own code goes to the network first: a stale-while-revalidate hit
    // here means a reload can still be running last week's CSS and JS. Icons and
    // fonts barely change, so those stay cache-first for speed and offline use.
    const isCode = /^\/(css|js)\//.test(url.pathname);
    if (isCode) {
      e.respondWith(fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || Response.error())));
      return;
    }
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const cached = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return cached || (await fresh) || Response.error();
    }));
  }
});

/* ---- push (see server/notify.js): a streak or daily reminder ---- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'TypeDash', {
    body: data.body || 'Your streak is waiting.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'typedash',
    data: { url: data.url || '/app' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    if (open) { open.navigate(url); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
