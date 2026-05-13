const CACHE = "coco-shell-v3";
const SHELL = ["/", "/login", "/manifest.json", "/icons/icon.svg"];
const NETWORK_TIMEOUT = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL).catch(() => undefined)
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

function fromNetwork(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(req).then(
      (res) => {
        clearTimeout(t);
        resolve(res);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Assets versionados do Next: cache-first (instantâneo, sem timeout).
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match("/"));
      })
    );
    return;
  }

  // Resto: network-first com timeout 3s; fallback pro cache (ou shell raiz).
  e.respondWith(
    fromNetwork(req, NETWORK_TIMEOUT)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((r) => r || caches.match("/"))
      )
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Coco da Amazônia", body: "Você tem um aviso." };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((wins) => {
      const win = wins[0];
      if (win) {
        win.navigate(url);
        win.focus();
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});

// Trigger background sync da fila offline
self.addEventListener("sync", (e) => {
  if (e.tag === "flush-sales-queue") {
    e.waitUntil(notifyClientsToFlush());
  }
});

async function notifyClientsToFlush() {
  const wins = await self.clients.matchAll();
  wins.forEach((c) => c.postMessage({ type: "flush-sales-queue" }));
}
