import { extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_USER_BYTES = 100 * 1024 * 1024;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const binaryTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const textTypes: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};
export async function validateUpload(originalName: string, data: Buffer) {
  const name = originalName
    .normalize('NFC')
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if (!name || Buffer.byteLength(name) > 180)
    throw new HttpError(400, 'Use a filename of 1–180 bytes.');
  if (!data.length) throw new HttpError(400, 'Empty files cannot be uploaded.');
  if (data.length > MAX_FILE_BYTES)
    throw new HttpError(413, 'Files must be 10 MB or smaller.');
  const extension = extname(name).toLowerCase();
  const expected = binaryTypes[extension];
  if (expected) {
    let actual;
    try {
      actual = await fileTypeFromBuffer(data);
    } catch {
      /* malformed content */
    }
    if (actual?.mime !== expected)
      throw new HttpError(400, 'File contents do not match the extension.');
    return { name, mime: expected };
  }
  if (textTypes[extension]) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
        throw new Error('Binary content');
    } catch {
      throw new HttpError(400, 'Text files must contain valid UTF-8 text.');
    }
    return { name, mime: textTypes[extension] };
  }
  throw new HttpError(400, 'Supported files: PDF, PNG, JPG, TXT, MD, and CSV.');
}
