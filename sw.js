// Service worker de Mis Finanzas: guarda la app en el equipo para que abra sin internet.
// Cambiá VERSION cada vez que publiques cambios para que los equipos se actualicen.
const VERSION = "mf-v1.0.0";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
const FIREBASE = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map(f => "https://www.gstatic.com/firebasejs/10.12.2/" + f);

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(FIREBASE.map(u => c.add(new Request(u, {mode:"cors"})).catch(() => {})));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firestore, login y APIs de Google: siempre por red (Firebase maneja su propio modo sin conexión).
  if (/googleapis\.com$|firebaseapp\.com$|identitytoolkit|securetoken/.test(url.hostname) && !url.hostname.startsWith("fonts.")) return;

  // Páginas: primero la versión guardada, así abre al instante y sin internet.
  if (req.mode === "navigate"){
    e.respondWith(caches.match("./index.html").then(r => r || fetch(req)));
    return;
  }
  // Archivos de la app, Firebase SDK y tipografías: caché primero, y se renueva en segundo plano.
  const cacheable = url.origin === location.origin || url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!cacheable) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit){ e.waitUntil(net); return hit; }
    const res = await net;
    return res || new Response("", {status:504, statusText:"Sin conexión"});
  })());
});
