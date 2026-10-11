/*
 * Killeshin GAA — service worker.
 *
 * This exists only so Chrome/Android will offer to install the site as an
 * app; it is not an offline-first rewrite of the site, because the whole
 * app is built around always showing live data, and a service worker's
 * normal job is to do the opposite of that.
 *
 * So: only the fixed "shell" files (the page itself, the crests, this
 * manifest) are ever cached, and only as a fallback for when there is no
 * signal at all. Anything that changes hour to hour - data.json, results,
 * crests.json, form.json, and every .ics calendar - is never touched here
 * and always goes straight to the network, exactly as it did with no
 * service worker installed.
 */
const CACHE = 'killeshin-shell-v1';
const SHELL = ['./', './index.html', './manifest.json', './crest.png', './crest-ladies.png'];

// Anything matching this must never be served from a cache, under any
// circumstance - including when offline, where the right behaviour is to
// let the fetch fail naturally rather than hand back a stale score.
const NEVER_CACHE = /\.json(\?|$)|\.ics(\?|$)/i;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* a shell asset 404ing must not block installing */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);

  // Only ever handle this site's own GET requests - never another origin
  // (fonts, the weather API, GoatCounter, the live-score backend), and
  // never anything matching the live-data files above.
  if (req.method !== 'GET' || url.origin !== location.origin || NEVER_CACHE.test(url.pathname + url.search)) {
    return;
  }

  // Network first, so anyone with a signal always gets the current page;
  // the cached shell is only ever a fallback for a dead connection.
  e.respondWith(
    fetch(req)
      .then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () { return caches.match(req); })
  );
});
