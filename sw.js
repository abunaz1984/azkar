/* Service worker for the azkar app: after the first visit the app opens without a network.
 *
 * Every launch: the page comes from the cache at once; in the background the worker asks the server
 * whether the page changed. If it did, the cache is refreshed and the open page is told to reload,
 * so a new version replaces the old one on the first launch after the files were updated.
 *
 * VERSION is stamped by build.py (a hash of every file of the app), so this file changes byte for byte
 * whenever the app changes: that is what makes the browser notice a new version at all. */
const VERSION = 'b694251a48';
const CACHE = 'azkary-' + VERSION;
let lastNotice = 0;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(new Request('./', { cache: 'reload' })))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function tellPages() {
  const now = Date.now();
  if (now - lastNotice < 60000) return;          // never more than once a minute (no reload loops)
  lastNotice = now;
  const pages = await self.clients.matchAll({ type: 'window' });
  pages.forEach((p) => p.postMessage({ type: 'azkary-updated' }));
}

// Ask the server (not the browser's HTTP cache: GitHub Pages lets files sit there for 10 minutes).
async function revalidate(req, cache, before) {
  try {
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res.ok || res.type !== 'basic' || res.redirected) return;
    let changed = false;
    if (before) {                                    // the page itself: compare with what was just shown
      const [a, b] = await Promise.all([before.text(), res.clone().text()]);
      changed = a !== b;
    }
    await cache.put(req, res.clone());
    if (changed) await tellPages();
  } catch (err) { /* offline: keep what we have */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let cached = await cache.match(req, { ignoreSearch: true });
    if (!cached && req.mode === 'navigate') cached = await cache.match('./');

    if (cached) {
      // the copy is taken before the page starts reading the response: afterwards it could not be cloned
      event.waitUntil(revalidate(req, cache, req.mode === 'navigate' ? cached.clone() : null));
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Нет сети. Откройте приложение один раз с интернетом.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
