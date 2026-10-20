/**
 * Minimal service worker: makes the app installable and keeps the shell usable
 * when the venue Wi-Fi drops (PRD Section 12 fallback).
 *
 * Verification itself needs the backend, so API calls are never cached - a
 * cached verdict would be a dangerous lie.
 */
const CACHE = "suarasah-shell-v1";
const SHELL = ["/", "/verify", "/live", "/sign", "/manifest.webmanifest", "/pcm-worklet.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch API traffic

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
  );
});
