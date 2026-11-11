import { loadConfig } from './config.js';
import { createPool } from './database.js';
import { createStorage } from './storage.js';
import { createApp } from './app.js';
const config = loadConfig();
const pool = createPool();
await pool.query('SELECT 1 FROM users LIMIT 1');
const { app, store } = await createApp(config, pool, createStorage(config));
const server = app.listen(config.port, () =>
  console.log(`Drop box API listening on http://localhost:${config.port}`),
);
// Keep session expiry cleanup outside requests; runtime role only needs DELETE on sessions.
const cleanup = setInterval(() => {
  pool
    .query('DELETE FROM sessions WHERE expire < now()')
    .catch(() => console.error('Session cleanup failed'));
}, 15 * 60_000);
cleanup.unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    clearInterval(cleanup);
    server.close(() => {
      store.close();
      void pool.end();
    });
  });
