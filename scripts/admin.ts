import { createPool } from '../src/server/database.js';
const [email, action = 'grant'] = process.argv.slice(2);
if (!email || !['grant', 'revoke'].includes(action)) {
  console.error('Usage: npm run admin -- user@example.com [grant|revoke]');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'Use the operator SQL workflow in docs/AZURE.md; the runtime identity cannot change roles.',
  );
}
const pool = createPool();
try {
  const result = await pool.query(
    'UPDATE users SET role = $1 WHERE email = $2 RETURNING email, role',
    [action === 'grant' ? 'admin' : 'user', email.toLowerCase()],
  );
  if (!result.rowCount)
    throw new Error('Register this account before changing its role.');
  console.log(result.rows[0]);
} finally {
  await pool.end();
}
