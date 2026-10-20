import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureDeployment, parsePreviewConfig } from '../configure-deployment.mjs';

const config = {
  accountId: 'a'.repeat(32), databaseId: '12345678-1234-1234-1234-123456789abc',
  clerkPublishableKey: `pk_test_${Buffer.from('planwatch-test.clerk.accounts.dev$').toString('base64')}`,
  clerkOwnerUserId: 'user_Owner', appOrigin: 'https://planwatch-v2-preview.pages.dev', apiOrigin: 'https://planwatch-api.workers.dev',
};
test('CI derives the trusted Clerk issuer from the public key and rejects unsafe or unrelated targets', () => {
  assert.equal(parsePreviewConfig(JSON.stringify(config)).clerkIssuer, 'https://planwatch-test.clerk.accounts.dev');
  for (const invalid of [
    { clerkPublishableKey: 'sk_test_must_not_be_used' }, { clerkOwnerUserId: '' },
    { appOrigin: 'https://another-project.pages.dev' }, { apiOrigin: 'http://api.example' },
    { apiOrigin: 'https://api.example/some-path' }, { databaseId: '00000000-0000-0000-0000-000000000000' },
  ]) assert.throws(() => parsePreviewConfig(JSON.stringify({ ...config, ...invalid })));
});
test('CI writes an API-only configuration with hosted bypass disabled and public-only frontend settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planwatch-config-test-'));
  try {
    await configureDeployment(JSON.stringify(config), root);
    const worker = JSON.parse(await readFile(join(root, 'wrangler.preview.jsonc'), 'utf8'));
    const frontend = await readFile(join(root, '.env.production.local'), 'utf8');
    assert.equal(worker.name, 'planwatch-v2-preview');
    assert.equal(worker.vars.LOCAL_DEV, 'false');
    assert.equal(worker.vars.CLERK_OWNER_USER_ID, config.clerkOwnerUserId);
    assert.equal(worker.d1_databases[0].database_id, config.databaseId);
    assert.equal(worker.assets, undefined);
    assert.match(frontend, /VITE_API_BASE_URL=https:\/\/planwatch-api.workers.dev\/api/);
    assert.doesNotMatch(frontend, /SECRET|TOKEN|OWNER|LOCAL_DEV/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
