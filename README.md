# Drop box

A small private file store for learning Azure security: TypeScript, Express, PostgreSQL, and Azure App Service. Register, sign in, upload a file, and download your own files. Administrators see account and upload **metadata**, without access to other people's downloads.

The interface includes drag and drop, upload feedback, search, sorting, storage usage, and an admin inventory. There are no public file links or seeded accounts.

## Run locally

Requires Node.js 22.15+ and Docker Compose (or an existing PostgreSQL 17+ database).

```sh
npm install
cp .env.example .env
# Replace SESSION_SECRET in .env with the output of:
openssl rand -hex 32
docker compose up -d --wait
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** and create an account. Vite proxies `/api` to Express on port 3000. Keep `APP_ORIGIN` consistent with the browser URL, including the hostname and port. The example database password is for loopback-only local development.

Local upload bytes live in `.data/files/`; metadata, users, and sessions live in PostgreSQL. Neither the data directory nor `.env` belongs in Git. Files survive app restarts; `docker compose down` preserves the database volume.

To grant or revoke the admin role after registering an account:

```sh
npm run admin -- you@example.com grant
npm run admin -- you@example.com revoke
```

The sidebar shows administration links after signing out and back in. Authorization reads the current role from the database on each request.

## Commands

| Command                | Purpose                                                   |
| ---------------------- | --------------------------------------------------------- |
| `npm run dev`          | Express watch mode and Vite development server            |
| `npm run db:migrate`   | Apply the idempotent initial schema as the database owner |
| `npm run typecheck`    | Check frontend, backend, scripts, and tests               |
| `npm run lint`         | Check TypeScript with ESLint                              |
| `npm run format:check` | Check formatting with Prettier                            |
| `npm run build`        | Compile server and bundle frontend into `dist/`           |
| `npm start`            | Run the built server, which also serves the frontend      |
| `npm test`             | Run validation and real PostgreSQL integration tests      |

For a local built-server preview, set `APP_ORIGIN=http://localhost:3000` in `.env`, then run `npm run build && npm start`. `NODE_ENV=production` intentionally requires Azure storage, HTTPS, and passwordless database configuration.

## Test

Use a disposable database. Tests create and remove an isolated schema; they require permission to create schemas and do not reuse the application's tables.

```sh
TEST_DATABASE_URL=postgresql://dropbox:local-training-only@localhost:5432/dropbox npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover unauthenticated access, registration, role escalation, login/logout, CSRF, owner-only downloads (including denial for admins), metadata exposure, file validation, storage traversal, and quotas. There is no coverage percentage target. Use descriptive `*.test.ts` names and add regression cases for security changes.

## Repository layout

- `src/server/`: authentication, sessions, ownership checks, validation, database and storage adapters.
- `src/client/`: responsive TypeScript interface, CSS, and static assets.
- `sql/`: schema migration; `scripts/`: migration, admin, and deployment helpers.
- `tests/`: Node test runner and Supertest integration tests.
- `infra/`: Azure Bicep and least-privilege SQL bootstrap.
- `docs/AZURE.md`: Azure deployment and identity setup.
- `docs/SECURITY.md`: trust boundaries, review exercises, and deliberate limits.

Use two-space indentation and the configured Prettier and ESLint tools. Keep role changes and migrations in the operator workflow; the Azure runtime identity has no permission to update account roles or create tables.

## Deploy to Azure

Follow [the Azure walkthrough](docs/AZURE.md). It provisions App Service, a private PostgreSQL server, private Blob uploads with shared keys disabled, and a Key Vault session secret. Runtime storage and database authentication use the App Service managed identity. **No Azure resources have been deployed by this project setup.**
