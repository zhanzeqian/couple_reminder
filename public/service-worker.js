const CACHE_NAME = "couple-reminder-v1";
const SEEN_PUSH_CACHE = "couple-reminder-seen-push-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match("/index.html"))
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const visible = clients.find((client) => "focus" in client);
      if (visible) return visible.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() || {};
  event.waitUntil(
    shouldShowPush(payload.eventId).then((shouldShow) => {
      if (!shouldShow) return;
      return self.registration.showNotification(payload.title || "新的提醒", {
        body: payload.body || "有一条新的待办更新。",
        icon: "/icons/icon.svg",
        badge: "/icons/icon.svg",
        data: { url: payload.url || "/", eventId: payload.eventId }
      });
    })
  );
});

async function shouldShowPush(eventId) {
  if (!eventId) return true;
  const cache = await caches.open(SEEN_PUSH_CACHE);
  const key = `/seen/${eventId}`;
  const existing = await cache.match(key);
  if (existing) return false;
  await cache.put(key, new Response("1"));
  return true;
}
