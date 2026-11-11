/* Service worker de Smash Badminton (appli autonome, hors claude.ai).
   - Fichiers de l'appli : le réseau d'abord, pour avoir la dernière version ; la copie en cache si le réseau
     est absent ou met plus de 3 secondes à répondre (gymnase mal couvert).
   - Polices Google : le cache d'abord ; elles sont enregistrées à la première visite en ligne.
   Changer APP vide l'ancien cache de l'appli. Les données du tournoi ne sont pas ici : elles sont dans localStorage. */
const APP = "smash-appli-v1";
const FONTS = "smash-polices-v1";
const SHELL = [
  "./",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const NETWORK_TIMEOUT = 3000;
const ROOT = new URL("./", self.location.href).href;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP)
      .then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("smash-") && k !== APP && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(fontFirst(event)); return; }
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  event.respondWith(networkFirst(event));
});

/* Les polices peuvent arriver sans passer par ici (première visite, cache du navigateur). À chaque chargement,
   la page envoie donc l'adresse de ses feuilles de style Google Fonts : on les garde, avec les fichiers qu'elles citent. */
self.addEventListener("message", event => {
  const d = event.data;
  if (!d || d.type !== "polices" || !Array.isArray(d.urls)) return;
  const urls = d.urls.filter(u => {
    try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "fonts.googleapis.com"; } catch (e) { return false; }
  }).slice(0, 8);
  event.waitUntil(keepFonts(urls));
});

async function keepFonts(sheets) {
  const cache = await caches.open(FONTS);
  const keep = async url => {
    let res = await cache.match(url, { ignoreVary: true });
    if (res) return res;
    res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    await cache.put(url, res.clone());
    return res;
  };
  await Promise.all(sheets.map(async sheet => {
    try {
      const res = await keep(sheet);
      if (!res) return;
      const files = Array.from(new Set((await res.text()).match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])).slice(0, 40);
      await Promise.all(files.map(f => keep(f).catch(() => null)));
    } catch (e) { /* hors ligne : ce sera pour le prochain chargement */ }
  }));
}

/* L'appli tient en une page : toute navigation dans le dossier reçoit cette page, rangée sous l'adresse du dossier */
async function networkFirst(event) {
  const req = event.request;
  const key = req.mode === "navigate" ? ROOT : req.url;
  const cache = await caches.open(APP);
  const cached = await cache.match(key, { ignoreVary: true });
  /* no-cache : on revalide auprès du serveur au lieu de se fier au cache du navigateur (GitHub Pages garde les fichiers
     10 minutes), pour qu'une mise à jour arrive tout de suite. On garde le mode de redirection de la requête d'origine :
     une navigation doit recevoir la redirection telle quelle. */
  const network = fetch(req.url, { cache: "no-cache", redirect: req.redirect, credentials: "same-origin" }).then(res => {
    if (res.ok && res.type === "basic") {
      event.waitUntil(cache.put(key, res.clone()).catch(() => { /* cache plein : tant pis */ }));
      return res;
    }
    return cached || res;
  });
  if (!cached) return network;
  let timer = null;
  const tooSlow = new Promise(resolve => { timer = setTimeout(() => resolve(cached), NETWORK_TIMEOUT); });
  try {
    return await Promise.race([network.catch(() => cached), tooSlow]);
  } finally {
    clearTimeout(timer);
  }
}

/* Polices : demandées en mode CORS pour ne pas stocker de réponses opaques */
async function fontFirst(event) {
  const url = event.request.url;
  const cache = await caches.open(FONTS);
  const cached = await cache.match(url, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (res.ok) event.waitUntil(cache.put(url, res.clone()).catch(() => { /* cache plein : tant pis */ }));
  return res;
}
