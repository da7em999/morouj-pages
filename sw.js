/* Morouj — offline-first service worker (batch 3: real shell + asset cache)
   Strategy:
   - Precache the app shell on install (index, manifest, icons, logo).
   - Navigations: network first, falling back to the cached shell so the
     rep app opens fully offline after the first online visit.
   - Static assets (hashed JS/CSS/fonts/images): stale-while-revalidate —
     served instantly from cache (offline-capable) and refreshed in the
     background whenever the network is available.
   - Web Push (rep bundle item 13, 2026-11-04): 'push' shows the
     notification from the payload {title, body, url, tag};
     'notificationclick' focuses an existing app window and navigates
     it to the deep link, or opens a new one. The sender side (VAPID
     private key + send function) is a documented server phase — the
     receiver here is complete and inert until pushes actually arrive. */
const CACHE = 'morouj-shell-v5';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network first, fall back to cached shell (offline open).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* ---- Web Push receiver (item 13) ---- */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'مروج — تنبيه مهم';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'morouj-alert',
    dir: 'rtl',
    lang: 'ar',
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        for (const win of windows) {
          if ('focus' in win) {
            if ('navigate' in win) win.navigate(target).catch(() => undefined);
            return win.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
