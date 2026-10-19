import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('public/sw.js', root), 'utf8');
function runtime(network) {
  const handlers = new Map();
  const stored = new Map();
  const fetched = [];
  const deleted = [];
  let activated = false;
  let claimed = false;
  const context = {
    self: { location: { origin: 'https://planwatch.example' }, clients: { claim: async () => { claimed = true; } }, skipWaiting: () => { activated = true; }, addEventListener: (type, handler) => handlers.set(type, handler) },
    caches: {
      open: async () => ({ put: async (path, response) => stored.set(path, response) }),
      match: async path => stored.get(path)?.clone(),
      keys: async () => ['other-app-cache', 'planwatch-public-v0', 'planwatch-public-v1'],
      delete: async key => { deleted.push(key); return true; },
    },
    fetch: async (request, options) => {
      fetched.push({ request, options });
      if (network) return network(request, options);
      return new Response(request === '/offline' ? '<!-- planwatch-offline --><h1>Reconnect</h1>' : new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': request === '/offline' ? 'text/html' : 'image/png' } });
    },
    URL, Response, Error,
  };
  vm.runInNewContext(source, context);
  return {
    handlers, stored, fetched, deleted,
    activated: () => activated, claimed: () => claimed,
    async lifecycle(type) { let work; handlers.get(type)({ waitUntil: promise => { work = promise; } }); await work; },
    async request(path, method = 'GET', mode = 'navigate') {
      let response;
      handlers.get('fetch')({ request: { url: new URL(path, context.self.location.origin).href, method, mode }, respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test('installation caches only the explicit public offline assets, without activating over an open app', async () => {
  const sw = runtime();
  await sw.lifecycle('install');
  assert.deepEqual([...sw.stored.keys()], ['/offline', '/icons/app-192.png', '/icons/app-512.png']);
  assert.equal(sw.activated(), false);
  assert.ok(sw.fetched.every(({ options }) => options.redirect === 'error'));
});
test('login HTML returned instead of the offline page is never cached', async () => {
  const sw = runtime(() => new Response('<h1>Sign in to Cloudflare</h1>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(sw.lifecycle('install'), /Unexpected offline page/);
  assert.equal(sw.stored.size, 0);
});
test('API, authentication URLs, write requests and other origins bypass the service worker', async () => {
  const sw = runtime();
  for (const path of ['/api/tasks', '/api/session', '/cdn-cgi/access/login', '/cdn-cgi/access/logout', 'https://another.example/']) {
    assert.equal(await sw.request(path), undefined);
  }
  assert.equal(await sw.request('/', 'POST'), undefined);
  assert.equal(await sw.request('/', 'GET', 'cors'), undefined);
  assert.equal(sw.fetched.length, 0);
  assert.equal(sw.stored.size, 0);
});
test('offline navigation uses the public fallback instead of caching private app responses', async () => {
  const sw = runtime(() => { throw new Error('Offline'); });
  sw.stored.set('/offline', new Response('Reconnect to open PlanWatch'));
  assert.equal(await (await sw.request('/')).text(), 'Reconnect to open PlanWatch');
  assert.equal(sw.stored.size, 1);
});
test('online navigation responses are returned and never added to the offline cache', async () => {
  const sw = runtime(() => new Response('An authenticated page response'));
  assert.equal(await (await sw.request('/')).text(), 'An authenticated page response');
  assert.equal(sw.stored.size, 0);
});
test('activation cleans up only owned caches and waits for an explicit update action', async () => {
  const sw = runtime();
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, ['planwatch-public-v0']);
  assert.equal(sw.claimed(), true);
  sw.handlers.get('message')({ data: 'UNRELATED' });
  assert.equal(sw.activated(), false);
  sw.handlers.get('message')({ data: 'ACTIVATE_UPDATE' });
  assert.equal(sw.activated(), true);
});
test('the install manifest has a stable app identity and real 192/512px PNGs', async () => {
  const manifest = JSON.parse(await readFile(new URL('public/manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const entry = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.purpose === 'any');
    assert.ok(entry);
    const png = await readFile(new URL(`public${entry.src}`, root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const apple = await readFile(new URL('public/icons/app-180.png', root));
  assert.equal(apple.readUInt32BE(16), 180);
});
