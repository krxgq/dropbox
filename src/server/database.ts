import 'dotenv/config';
import pg from 'pg';
import {
  DefaultAzureCredential,
  ManagedIdentityCredential,
} from '@azure/identity';

export function createPool(env: NodeJS.ProcessEnv = process.env) {
  if (env.DATABASE_URL && env.NODE_ENV !== 'production') {
    return new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  for (const key of ['PGHOST', 'PGDATABASE', 'PGUSER']) {
    if (!env[key])
      throw new Error(`${key} is required for passwordless PostgreSQL.`);
  }
  const credential =
    env.NODE_ENV === 'production'
      ? new ManagedIdentityCredential()
      : new DefaultAzureCredential();
  return new pg.Pool({
    host: env.PGHOST,
    database: env.PGDATABASE,
    user: env.PGUSER,
    port: 5432,
    max: 10,
    ssl: { rejectUnauthorized: true },
    // pg invokes this on each new connection, so expired tokens are never cached here.
    password: async () =>
      (
        await credential.getToken(
          'https://ossrdbms-aad.database.windows.net/.default',
        )
      ).token,
  });
}
