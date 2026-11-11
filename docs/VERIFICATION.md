# Verification in the authoring environment

The frontend passed a standalone strict TypeScript check using the installed compiler:

```sh
tsc --noEmit --strict --target ES2022 --lib ES2022,DOM,DOM.Iterable \
  --module ESNext --moduleResolution bundler src/client/main.ts
```

The initial SQL schema applied successfully using the installed PostgreSQL 18.6 standalone backend (not the target PostgreSQL 17 server). Seven production configuration assertions passed using a cached Zod package. The runtime SQL grants were also exercised in that standalone database: ordinary registration succeeded, while an explicit admin-role insert, a role update, and schema creation were denied. These checks do not replace the integration suite.

All supported source and documentation files were formatted with Prettier from the existing local package cache. The original `AGENTS.md` was preserved.

Full dependency installation could not complete: the environment cannot resolve `registry.npmjs.org`, its approval policy rejected an elevated installation attempt, and the offline cache lacks Azure Identity and other required packages. Consequently no complete install or `package-lock.json` was generated. Run `npm install` in a network-enabled environment and retain the resulting lockfile before using `npm ci` or packaging a deployment.

The sandbox also rejects local TCP listeners with `EPERM` and access to the Docker socket. The full server build, ESLint, real PostgreSQL integration suite, and browser workflow could not be executed here. Bicep compilation and an Azure deployment were not performed. These are outstanding verification steps, not passing checks.

Run the checks documented in `README.md` and `docs/AZURE.md` before deploying. The app has no simulated authentication, seeded admin, cloud credentials, or production bypass to compensate for the environment restrictions.
