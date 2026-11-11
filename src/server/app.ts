import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import type pg from 'pg';
import { z } from 'zod';
import type { Config } from './config.js';
import type { FileStorage } from './storage.js';
import {
  HttpError,
  MAX_FILE_BYTES,
  MAX_USER_BYTES,
  validateUpload,
} from './uploads.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrf?: string;
  }
}
interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
}
declare global {
  namespace Express {
    interface Locals {
      user?: User;
    }
  }
}

const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  // bcrypt only uses the first 72 bytes; reject rather than silently truncate.
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((value) => Buffer.byteLength(value) <= 72),
});
const registration = credentials
  .extend({ name: z.string().trim().min(1).max(80) })
  .strict();
const login = credentials.strict();
const safeUserColumns = 'id, name, email, role';

export async function createApp(
  config: Config,
  pool: pg.Pool,
  storage: FileStorage,
) {
  const app = express();
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    pruneSessionInterval: false,
  });
  const dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);
  app.disable('x-powered-by');
  // App Service terminates TLS at its single ingress proxy.
  if (config.production) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 150,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again shortly.' },
    }),
  );
  app.use('/api', express.json({ limit: '8kb' }));
  const cookieName = config.production ? '__Host-dropbox.sid' : 'dropbox.sid';
  app.use(
    '/api',
    session({
      name: cookieName,
      secret: config.secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
      },
    }),
  );
  app.use('/api', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session.userId) {
      const result = await pool.query(
        `SELECT ${safeUserColumns} FROM users WHERE id = $1`,
        [req.session.userId],
      );
      res.locals.user = result.rows[0];
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    const supplied = req.get('x-csrf-token') ?? '';
    const expected = req.session.csrf ?? '';
    if (
      req.get('origin') !== config.origin ||
      !expected ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      throw new HttpError(
        403,
        'Request verification failed. Refresh the page and try again.',
      );
    }
    next();
  });
  const authenticated: RequestHandler = (_req, res, next) => {
    if (!res.locals.user)
      throw new HttpError(401, 'Please sign in to continue.');
    next();
  };
  const admin: RequestHandler = (_req, res, next) => {
    if (res.locals.user?.role !== 'admin')
      throw new HttpError(403, 'Administrator access required.');
    next();
  };
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });
  app.get('/api/session', (req, res) => {
    req.session.csrf ??= randomBytes(32).toString('hex');
    res.json({
      user: res.locals.user ?? null,
      csrfToken: req.session.csrf,
      limits: { fileBytes: MAX_FILE_BYTES, storageBytes: MAX_USER_BYTES },
    });
  });
  async function establishSession(req: express.Request, userId: string) {
    await new Promise<void>((done, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : done())),
    );
    req.session.userId = userId;
    req.session.csrf = randomBytes(32).toString('hex');
  }
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const body = registration.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const id = randomUUID();
    try {
      const result = await pool.query(
        `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${safeUserColumns}`,
        [id, body.name, body.email, passwordHash],
      );
      await establishSession(req, id);
      res
        .status(201)
        .json({ user: result.rows[0], csrfToken: req.session.csrf });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new HttpError(
          409,
          'Unable to register with this email. Try signing in.',
        );
      throw error;
    }
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const body = login.parse(req.body);
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [body.email],
    );
    const user = result.rows[0];
    const valid = await bcrypt.compare(
      body.password,
      user?.password_hash ?? dummyHash,
    );
    if (!user || !valid)
      throw new HttpError(401, 'Email or password is incorrect.');
    await establishSession(req, user.id);
    const profile = await pool.query(
      `SELECT ${safeUserColumns} FROM users WHERE id = $1`,
      [user.id],
    );
    res.json({ user: profile.rows[0], csrfToken: req.session.csrf });
  });
  app.post('/api/auth/logout', authenticated, async (req, res) => {
    await new Promise<void>((done, reject) =>
      req.session.destroy((error) => (error ? reject(error) : done())),
    );
    res.clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
    });
    res.status(204).end();
  });
  app.get('/api/files', authenticated, async (_req, res) => {
    const result = await pool.query(
      'SELECT id, name, mime, size, created_at FROM files WHERE owner_id = $1 ORDER BY created_at DESC',
      [res.locals.user!.id],
    );
    res.json({ files: result.rows });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 },
  });
  app.post(
    '/api/files',
    authenticated,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw new HttpError(400, 'Choose a file to upload.');
      const { name, mime } = await validateUpload(
        req.file.originalname,
        req.file.buffer,
      );
      const owner = res.locals.user!.id;
      const id = randomUUID();
      const key = `${owner}/${id}`;
      const client = await pool.connect();
      let stored = false;
      try {
        await client.query('BEGIN');
        // Serialize quota checks for this owner across processes without granting user UPDATE rights.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          owner,
        ]);
        const usage = await client.query(
          'SELECT COALESCE(SUM(size), 0)::bigint AS bytes, COUNT(*)::int AS count FROM files WHERE owner_id = $1',
          [owner],
        );
        if (
          Number(usage.rows[0].bytes) + req.file.size > MAX_USER_BYTES ||
          usage.rows[0].count >= 100
        ) {
          throw new HttpError(
            409,
            'Your storage limit is 100 MB or 100 files.',
          );
        }
        await storage.put(key, req.file.buffer);
        stored = true;
        const result = await client.query(
          'INSERT INTO files (id, owner_id, name, mime, size, storage_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, mime, size, created_at',
          [id, owner, name, mime, req.file.size, key],
        );
        await client.query('COMMIT');
        res.status(201).json({ file: result.rows[0] });
      } catch (error) {
        await client.query('ROLLBACK');
        if (stored)
          await storage
            .remove(key)
            .catch(() =>
              console.error('Upload cleanup failed', { fileId: id }),
            );
        throw error;
      } finally {
        client.release();
      }
    },
  );
  app.get('/api/files/:id/download', authenticated, async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success)
      throw new HttpError(404, 'File not found.');
    // There is deliberately no admin override: ownership is enforced in the query.
    const result = await pool.query(
      'SELECT name, mime, storage_key FROM files WHERE id = $1 AND owner_id = $2',
      [req.params.id, res.locals.user!.id],
    );
    const file = result.rows[0];
    if (!file) throw new HttpError(404, 'File not found.');
    const bytes = await storage.get(file.storage_key);
    res.attachment(file.name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  });
  app.get('/api/admin/users', authenticated, admin, async (_req, res) => {
    const result =
      await pool.query(`SELECT u.id, u.name, u.email, u.role, u.created_at,
      COUNT(f.id)::int AS file_count, COALESCE(SUM(f.size),0)::bigint AS storage_bytes
      FROM users u LEFT JOIN files f ON f.owner_id = u.id GROUP BY u.id ORDER BY u.created_at DESC`);
    res.json({ users: result.rows });
  });
  app.get('/api/admin/uploads', authenticated, admin, async (_req, res) => {
    const result =
      await pool.query(`SELECT f.id, f.name, f.mime, f.size, f.created_at, u.name AS owner_name, u.email AS owner_email
      FROM files f JOIN users u ON u.id = f.owner_id ORDER BY f.created_at DESC`);
    res.json({ files: result.rows });
  });
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Endpoint not found.');
  });
  app.use(express.static(resolve('dist/client'), { index: 'index.html' }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error:
          'Check your details. Use a valid email and a password of 12–72 bytes; names must be 1–80 characters.',
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error:
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Files must be 10 MB or smaller.'
            : 'Upload one file at a time, with no extra fields.',
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (
      error.type === 'entity.too.large' ||
      error.type === 'entity.parse.failed'
    ) {
      res.status(error.status).json({ error: 'Invalid request body.' });
      return;
    }
    console.error('Request failed', { name: error.name, code: error.code });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
  app.use(errorHandler);
  return { app, store };
}
