import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUpload } from '../src/server/uploads.js';
import { loadConfig } from '../src/server/config.js';

test('text uploads normalize names and discard directory components', async () => {
  const file = await validateUpload(
    '../../training/notes.txt',
    Buffer.from('hello'),
  );
  assert.equal(file.name, 'notes.txt');
  assert.equal(file.mime, 'text/plain');
  assert.equal(
    (await validateUpload('C:\\notes.txt', Buffer.from('hello'))).name,
    'notes.txt',
  );
});
test('production fails closed without passwordless database and Azure storage', () => {
  const base = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-unique-test-secret-of-at-least-32-characters',
    APP_ORIGIN: 'https://example.com',
  };
  assert.throws(() => loadConfig(base));
  assert.throws(() =>
    loadConfig({
      ...base,
      STORAGE_DRIVER: 'azure',
      DATABASE_URL: 'postgres://password',
    }),
  );
  assert.throws(() =>
    loadConfig({
      ...base,
      SESSION_SECRET: '@Microsoft.KeyVault(SecretUri=unresolved-reference)',
    }),
  );
  assert.throws(() =>
    loadConfig({ ...base, APP_ORIGIN: 'http://example.com' }),
  );
});
test('text validation rejects invalid encoding and executable extensions', async () => {
  await assert.rejects(() =>
    validateUpload('data.txt', Buffer.from([0xc3, 0x28])),
  );
  await assert.rejects(() =>
    validateUpload('script.svg', Buffer.from('<svg/>')),
  );
  await assert.rejects(() => validateUpload('run.exe', Buffer.from('MZ')));
});
