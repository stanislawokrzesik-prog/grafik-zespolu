const CACHE_NAME = "grafik-zespolu-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Aplikacja jest narzędziem do współpracy na żywo (Supabase) — nie działa sensownie
// offline. Ten Service Worker istnieje głównie po to, by przeglądarka pozwoliła
// zainstalować aplikację jako "prawdziwą" appkę na telefonie/komputerze.
// Strategia: zawsze próbuj sieci; jeśli sieć zawiedzie, spróbuj oddać coś z cache
// (przydatne np. przy krótkiej utracie łączności podczas przechodzenia między ekranami).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---------- prawdziwe powiadomienia push (działają nawet gdy aplikacja jest zamknięta) ----------
self.addEventListener("push", (event) => {
  let data = { title: "Grafik zespołu", body: "Masz nowe powiadomienie." };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "grafik-zespolu",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })
  );
});
