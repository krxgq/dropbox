import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type pg from 'pg';
import { createApp } from '../src/server/app.js';
import { createPool } from '../src/server/database.js';
import { loadConfig } from '../src/server/config.js';
import { createStorage, type FileStorage } from '../src/server/storage.js';

// This suite intentionally uses real PostgreSQL, including real session storage.
// It creates an isolated schema and refuses a missing explicit test database URL.
const databaseUrl = process.env.TEST_DATABASE_URL;
let pool: pg.Pool;
let app: Express;
let closeStore: () => void;
let path: string;
let storage: FileStorage;
const schema = `test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const origin = 'http://localhost:5173';
let alice: ReturnType<typeof request.agent>;
let bob: ReturnType<typeof request.agent>;
let admin: ReturnType<typeof request.agent>;
let aliceToken: string;
let bobToken: string;
let fileId: string;
let fileKey: string;

before(async () => {
  if (!databaseUrl)
    throw new Error(
      'Set TEST_DATABASE_URL to a disposable PostgreSQL database. See README.md.',
    );
  const base = createPool({ DATABASE_URL: databaseUrl });
  await base.query(`CREATE SCHEMA ${schema}`);
  await base.end();
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  pool = createPool({ DATABASE_URL: url.toString() });
  await pool.query(
    await readFile(new URL('../sql/001-initial.sql', import.meta.url), 'utf8'),
  );
  path = await mkdtemp(join(tmpdir(), 'dropbox-test-'));
  const config = loadConfig({
    SESSION_SECRET: 'test-only-secret-that-is-over-32-characters',
    LOCAL_STORAGE_PATH: path,
    APP_ORIGIN: origin,
  });
  storage = createStorage(config);
  const built = await createApp(config, pool, storage);
  app = built.app;
  closeStore = () => built.store.close();
  alice = request.agent(app);
  bob = request.agent(app);
  admin = request.agent(app);
});
after(async () => {
  closeStore?.();
  if (pool) {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  }
  if (path) await rm(path, { recursive: true, force: true });
});
async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
  name: string,
) {
  const bootstrap = await agent.get('/api/session').expect(200);
  const result = await agent
    .post('/api/auth/register')
    .set('Origin', origin)
    .set('x-csrf-token', bootstrap.body.csrfToken)
    .send({ email, name, password: 'A long unique passphrase 123!' })
    .expect(201);
  assert.equal(result.body.user.role, 'user');
  assert.equal(result.body.user.password_hash, undefined);
  return result.body.csrfToken as string;
}

test('anonymous clients cannot list files or access administration', async () => {
  await request(app).get('/api/files').expect(401);
  await request(app).get('/api/admin/users').expect(401);
  await request(app).get('/api/admin/uploads').expect(401);
});
test('registration creates ordinary users and rotates the CSRF token', async () => {
  aliceToken = await register(alice, 'ALICE@example.com', 'Alice');
  bobToken = await register(bob, 'bob@example.com', 'Bob');
  await register(admin, 'admin@example.com', 'Administrator');
  await pool.query(
    "UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'",
  );
  const session = await alice.get('/api/session').expect(200);
  assert.equal(session.body.user.email, 'alice@example.com');
  assert.equal(session.body.csrfToken, aliceToken);
});
test('registration rejects client-supplied admin privileges', async () => {
  const client = request.agent(app);
  const session = await client.get('/api/session');
  await client
    .post('/api/auth/register')
    .set('Origin', origin)
    .set('x-csrf-token', session.body.csrfToken)
    .send({
      name: 'Bad',
      email: 'bad@example.com',
      password: 'A long passphrase 123!',
      role: 'admin',
    })
    .expect(400);
});
test('state changes reject missing CSRF tokens and foreign origins', async () => {
  await alice
    .post('/api/files')
    .set('Origin', origin)
    .attach('file', Buffer.from('hello'), 'hello.txt')
    .expect(403);
  await alice
    .post('/api/files')
    .set('Origin', 'https://evil.example')
    .set('x-csrf-token', aliceToken)
    .attach('file', Buffer.from('hello'), 'hello.txt')
    .expect(403);
});
test('owners can upload and download their file; other users cannot discover it', async () => {
  const uploaded = await alice
    .post('/api/files')
    .set('Origin', origin)
    .set('x-csrf-token', aliceToken)
    .attach('file', Buffer.from('private training notes'), 'notes.txt')
    .expect(201);
  fileId = uploaded.body.file.id;
  assert.equal(uploaded.body.file.storage_key, undefined);
  const result = await pool.query(
    'SELECT storage_key FROM files WHERE id = $1',
    [fileId],
  );
  fileKey = result.rows[0].storage_key;
  const own = await alice.get('/api/files').expect(200);
  assert.equal(own.body.files.length, 1);
  const others = await bob.get('/api/files').expect(200);
  assert.equal(others.body.files.length, 0);
  const download = await alice.get(`/api/files/${fileId}/download`).expect(200);
  assert.equal(download.body.toString(), 'private training notes');
  assert.match(download.headers['content-disposition'], /^attachment;/);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.equal(download.headers['cache-control'], 'no-store');
});
test('IDOR is blocked for another user, an admin, and anonymous clients', async () => {
  await bob.get(`/api/files/${fileId}/download`).expect(404);
  await admin.get(`/api/files/${fileId}/download`).expect(404);
  await request(app).get(`/api/files/${fileId}/download`).expect(401);
  await alice.get('/api/files/not-a-uuid/download').expect(404);
  await alice.get(`/api/files/${crypto.randomUUID()}/download`).expect(404);
});
test('users cannot access admin lists; admins receive metadata without storage keys or passwords', async () => {
  await alice.get('/api/admin/users').expect(403);
  await bob.get('/api/admin/uploads').expect(403);
  const people = await admin.get('/api/admin/users').expect(200);
  assert.equal(people.body.users.length, 3);
  assert.ok(
    people.body.users.every(
      (item: Record<string, unknown>) => !('password_hash' in item),
    ),
  );
  const uploads = await admin.get('/api/admin/uploads').expect(200);
  assert.equal(uploads.body.files[0].owner_email, 'alice@example.com');
  assert.equal(uploads.body.files[0].storage_key, undefined);
  assert.equal(uploads.body.files[0].content, undefined);
  assert.equal(
    JSON.stringify(uploads.body).includes('private training notes'),
    false,
  );
});
test('role changes take effect on the next request', async () => {
  await pool.query(
    "UPDATE users SET role = 'user' WHERE email = 'admin@example.com'",
  );
  await admin.get('/api/admin/users').expect(403);
  await pool.query(
    "UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'",
  );
  await admin.get('/api/admin/users').expect(200);
});
test('uploads reject unsupported types, fake signatures, binary text, empty and oversized files', async () => {
  for (const [name, buffer] of [
    ['script.html', Buffer.from('<script>alert(1)</script>')],
    ['fake.pdf', Buffer.from('not really a pdf')],
    ['fake.png', Buffer.from('not really an image')],
    ['binary.txt', Buffer.from([0, 255, 17])],
    ['empty.txt', Buffer.alloc(0)],
  ] as const) {
    await alice
      .post('/api/files')
      .set('Origin', origin)
      .set('x-csrf-token', aliceToken)
      .attach('file', buffer, name)
      .expect(400);
  }
  await alice
    .post('/api/files')
    .set('Origin', origin)
    .set('x-csrf-token', aliceToken)
    .attach('file', Buffer.alloc(10 * 1024 ** 2 + 1, 'x'), 'large.txt')
    .expect(413);
});
test('an exhausted quota rejects uploads before storing data', async () => {
  const owner = (await bob.get('/api/session')).body.user.id;
  for (let i = 0; i < 10; i++) {
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO files (id, owner_id, name, mime, size, storage_key) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, owner, 'quota.txt', 'text/plain', 10 * 1024 ** 2, `${owner}/${id}`],
    );
  }
  await bob
    .post('/api/files')
    .set('Origin', origin)
    .set('x-csrf-token', bobToken)
    .attach('file', Buffer.from('one byte too many'), 'small.txt')
    .expect(409);
});
test('storage keys cannot escape the private storage directory', async () => {
  await assert.rejects(() => storage.get('../../package.json'));
  await assert.rejects(() => storage.put('../outside', Buffer.from('no')));
  assert.equal(
    (await storage.get(fileKey)).toString(),
    'private training notes',
  );
});
test('logout invalidates the session; login rejects incorrect credentials', async () => {
  await alice
    .post('/api/auth/logout')
    .set('Origin', origin)
    .set('x-csrf-token', aliceToken)
    .expect(204);
  await alice.get('/api/files').expect(401);
  const session = await alice.get('/api/session');
  await alice
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', session.body.csrfToken)
    .send({
      email: 'alice@example.com',
      password: 'An incorrect passphrase 123!',
    })
    .expect(401);
  const login = await alice
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('x-csrf-token', session.body.csrfToken)
    .send({
      email: 'alice@example.com',
      password: 'A long unique passphrase 123!',
    })
    .expect(200);
  assert.notEqual(login.body.csrfToken, session.body.csrfToken);
  await alice.get('/api/files').expect(200);
});
