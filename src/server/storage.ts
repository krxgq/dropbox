import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import {
  DefaultAzureCredential,
  ManagedIdentityCredential,
} from '@azure/identity';
import type { Config } from './config.js';

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
const keyPattern = /^[a-f0-9-]{36}\/([a-f0-9-]{36})$/;
function checkKey(key: string) {
  if (!keyPattern.test(key)) throw new Error('Invalid internal storage key');
}
export function createStorage(config: Config): FileStorage {
  if (config.driver === 'azure') {
    const credential = config.production
      ? new ManagedIdentityCredential()
      : new DefaultAzureCredential();
    const container = new BlobServiceClient(
      `https://${config.account}.blob.core.windows.net`,
      credential,
    ).getContainerClient(config.container);
    return {
      async put(key, data) {
        checkKey(key);
        await container.getBlockBlobClient(key).uploadData(data, {
          conditions: { ifNoneMatch: '*' },
          blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
        });
      },
      async get(key) {
        checkKey(key);
        return container.getBlockBlobClient(key).downloadToBuffer();
      },
      async remove(key) {
        checkKey(key);
        await container.getBlockBlobClient(key).deleteIfExists();
      },
    };
  }
  return {
    async put(key, data) {
      checkKey(key);
      const path = join(config.localPath, key);
      await mkdir(join(config.localPath, key.split('/')[0]), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    },
    async get(key) {
      checkKey(key);
      return readFile(join(config.localPath, key));
    },
    async remove(key) {
      checkKey(key);
      await unlink(join(config.localPath, key)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        },
      );
    },
  };
}
