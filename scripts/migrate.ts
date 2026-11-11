import { readFile } from 'node:fs/promises';
import { createPool } from '../src/server/database.js';
const pool = createPool();
try {
  await pool.query(
    await readFile(new URL('../sql/001-initial.sql', import.meta.url), 'utf8'),
  );
  console.log('Database schema is ready.');
} finally {
  await pool.end();
}
