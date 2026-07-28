const CACHE = 'opencode-web-lite-shell-v1'
const SHELL = ['/offline.html', '/pwa-offline.css', '/favicon.svg', '/pwa-icon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    SHELL.map((path) => new Request(path, { cache: 'reload' })),
  )))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('opencode-web-lite-shell-') && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match('/offline.html')))
    return
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-cache' }).then((response) => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())))
      return response
    }).catch(() => caches.match(request)))
  }
})
