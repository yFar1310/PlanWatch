const CACHE = 'planwatch-public-v1';
const PUBLIC_FILES = [
  ['/offline', 'text/html'],
  ['/icons/app-192.png', 'image/png'],
  ['/icons/app-512.png', 'image/png'],
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const [path, type] of PUBLIC_FILES) {
      const response = await fetch(path, { redirect: 'error', cache: 'reload', credentials: 'same-origin' });
      if (!response.ok || response.redirected || !response.headers.get('Content-Type')?.startsWith(type)) throw new Error('Public offline assets unavailable');
      if (path === '/offline' && !(await response.clone().text()).includes('<!-- planwatch-offline -->')) throw new Error('Unexpected offline page');
      await cache.put(path, response);
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('planwatch-public-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Cache only the public offline screen/icons. Never intercept API, login, or task responses.
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname !== '/') return;
  event.respondWith((async () => {
    try { return await fetch(event.request); }
    catch { return (await caches.match('/offline')) ?? new Response('Reconnect to open PlanWatch.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
  })());
});
