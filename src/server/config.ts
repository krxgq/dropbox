import 'dotenv/config';
import { resolve } from 'node:path';
import { z } from 'zod';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET ?? '';
  if (
    secret.length < 32 ||
    (production &&
      (secret.startsWith('local-') || secret.startsWith('@Microsoft.KeyVault')))
  ) {
    throw new Error(
      'SESSION_SECRET must be a resolved secret of at least 32 characters.',
    );
  }
  const origin = z.url().parse(env.APP_ORIGIN ?? 'http://localhost:5173');
  if (production && !origin.startsWith('https://'))
    throw new Error('Production requires an HTTPS APP_ORIGIN.');
  const driver = z
    .enum(['local', 'azure'])
    .parse(env.STORAGE_DRIVER ?? 'local');
  if (production && (driver !== 'azure' || env.DATABASE_URL)) {
    throw new Error(
      'Production requires Azure storage and passwordless PostgreSQL configuration.',
    );
  }
  if (
    driver === 'azure' &&
    (!env.AZURE_STORAGE_ACCOUNT || !env.AZURE_STORAGE_CONTAINER)
  ) {
    throw new Error('Azure storage account and container are required.');
  }
  return {
    production,
    secret,
    origin: new URL(origin).origin,
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? 3000),
    driver,
    localPath: resolve(env.LOCAL_STORAGE_PATH ?? '.data/files'),
    account: env.AZURE_STORAGE_ACCOUNT ?? '',
    container: env.AZURE_STORAGE_CONTAINER ?? '',
  };
}
export type Config = ReturnType<typeof loadConfig>;
