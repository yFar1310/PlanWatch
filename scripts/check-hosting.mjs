import { readFile } from 'node:fs/promises';

const { appOrigin, apiOrigin } = JSON.parse(await readFile(new URL('../.wrangler/preview-origins.json', import.meta.url), 'utf8'));
async function check(name, url, init, expected, validate = () => true) {
  let reason = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const text = await response.text();
      if (response.status === expected && validate(response, text)) { console.log(`PASS ${name}`); return true; }
      reason = `HTTP ${response.status}, expected ${expected}, or response/header validation failed`;
    } catch (error) { reason = error.cause?.code ?? error.name; }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  console.error(`FAIL ${name}: ${reason}`);
  return false;
}
const result = await Promise.all([
  check('Pages app', appOrigin + '/', {}, 200, (_, body) => body.includes('id="app"')),
  check('install manifest', appOrigin + '/manifest.webmanifest', {}, 200, (r, body) => r.headers.get('content-type')?.includes('json') && JSON.parse(body).name === 'PlanWatch'),
  check('public offline screen', appOrigin + '/offline', {}, 200, (_, body) => body.includes('planwatch-offline')),
  check('unauthenticated API stays closed', apiOrigin + '/api/session', { headers: { Origin: appOrigin } }, 401, (r, body) => r.headers.get('access-control-allow-origin') === appOrigin && JSON.parse(body).error === 'sign_in_required'),
  check('allowed preflight', apiOrigin + '/api/tasks', { method: 'OPTIONS', headers: { Origin: appOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } }, 204, r => r.headers.get('access-control-allow-origin') === appOrigin),
  check('other origin rejected', apiOrigin + '/api/tasks', { method: 'OPTIONS', headers: { Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST' } }, 403, r => !r.headers.has('access-control-allow-origin')),
]);
// The calendar is lazy loaded: checking only index.html can miss a missing JS chunk.
async function checkCalendarAssets() {
  try {
    const page = await fetch(appOrigin + '/', {signal:AbortSignal.timeout(10_000)});
    const html = await page.text(), entry = html.match(/src="(\/assets\/index-[\w-]+\.js)"/)?.[1];
    if (!entry) throw new Error('Frontend entry script missing');
    const module = await fetch(appOrigin + entry, {signal:AbortSignal.timeout(10_000)});
    if (!module.ok || !module.headers.get('content-type')?.includes('javascript')) throw new Error('Frontend script unavailable');
    const calendar = (await module.text()).match(/CalendarChart-[\w-]+\.js/)?.[0];
    if (!calendar) throw new Error('Calendar script reference missing');
    return await check('lazy-loaded calendar script', appOrigin + '/assets/' + calendar, {}, 200,
      (response,body)=>!!response.headers.get('content-type')?.includes('javascript')&&!body.includes('<!DOCTYPE html>'));
  } catch (error) {
    console.error(`FAIL calendar assets: ${error.cause?.code ?? error.message}`);
    return false;
  }
}
result.push(await checkCalendarAssets());
if (result.some(passed => !passed)) process.exitCode = 1;
