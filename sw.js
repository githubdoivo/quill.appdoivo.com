// Offline support: the app shell is cached on install and served cache-first;
// a new version (VERSION bump) replaces the old cache. No data is ever cached
// here — the journal lives in IndexedDB.
const VERSION = "journal-v3";
const SHELL = ["/", "/index.html", "/app.css?v=2", "/js/app.js?v=2", "/js/frame.js", "/js/look.js", "/js/model.js", "/js/db.js", "/js/words.js", "/js/images.js", "/js/zip.js", "/privacy.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: url.pathname.startsWith("/js/") }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error()))));
});
