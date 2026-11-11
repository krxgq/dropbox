# Security model and review exercises

## Boundaries

The browser receives opaque, HttpOnly session cookies and a CSRF token. PostgreSQL stores sessions; login regenerates the session ID and token. Sessions expire after eight hours. State changes require the configured origin and a session-bound CSRF header, including login and registration. Production cookies use `Secure`, `SameSite=Lax`, and the `__Host-` prefix. Passwords are hashed with bcrypt cost 12; inputs exceeding bcrypt's 72-byte limit are rejected.

Every API request reloads the account's role. Registration accepts only name, email, and password. There is no public role-management endpoint. Admin list responses explicitly select safe columns and never contain password hashes, storage keys, or file bytes.

Download authorization uses `WHERE id = $1 AND owner_id = $2`, where the owner comes from the server session. Missing and unauthorized files both return 404. Admins have no download override. Blob URLs and SAS tokens never go to the browser. The local storage directory is outside the served frontend tree.

Uploads allow PDF, PNG, JPG, UTF-8 TXT, MD, and CSV. Binary signatures must match extensions; client MIME headers are not trusted. Files are limited to 10 MiB each, 100 MiB and 100 files per user. A PostgreSQL advisory transaction lock serializes quota checks. Storage keys are generated UUID pairs, independent of user filenames. Failed metadata writes attempt to delete the uploaded blob. Downloads always use attachment disposition, octet-stream content type, and `nosniff`; text and documents are never rendered inline.

In Azure, the system identity can access only the upload container, the session secret, and the required database tables/columns. It cannot change roles or run schema migrations. Production startup rejects local storage, database passwords, and unresolved Key Vault references.

## Practical exercises

1. Create Alice, Bob, and an administrator. Upload as Alice and copy the file UUID from the API response. Attempt the download as Bob and the admin: both must get 404.
2. Submit `role: "admin"` during registration; expect 400. Try admin endpoints as Bob; expect 403. Revoke admin through the operator workflow; existing sessions must immediately lose API access.
3. Upload an executable renamed to `.pdf`, invalid UTF-8 in `.txt`, a zero-byte file, and a file over 10 MiB; each must fail. Try an HTML or SVG extension; expect 400.
4. Remove the CSRF header, forge the Origin header, or reuse the pre-login token after login; expect 403.
5. Review the runtime grants. Verify the managed identity cannot `UPDATE users SET role = 'admin'` or create a table. Verify anonymous blob reads and shared-key authentication fail.
6. Remove the Blob role or PostgreSQL grants and observe the app fail closed. Rotate the session secret in Key Vault and refresh the App Service reference; existing sessions become invalid.

## Deliberate scope limits

This is a training app, not a public storage service. Registration is open to visitors who can reach the app; use App Service access restrictions to limit a lab's audience. Application roles govern app endpoints; Azure RBAC governs the app identity's access to cloud resources. Neither prevents a subscription owner, database operator, or storage administrator from directly accessing data. Metadata includes filenames and email addresses and may itself be sensitive.

There is no password recovery, email verification, antivirus scanning, file deletion, MFA, audit pipeline, or per-user encryption. File signatures are format checks, not malware scanning. A crash between blob creation and metadata commit can leave an orphan blob; a lab operator can reconcile storage against metadata. MIME validation does not make downloaded files safe to open.

Rate limits are in memory and intended for one App Service instance; distribute them before scaling out. Uploads and downloads buffer at most 10 MiB per file, but concurrent transfers consume additional memory. Add concurrency limits or streaming before increasing limits or exposing the app broadly. Admin inventories are unpaginated for this small lab. The storage and vault endpoints remain publicly addressable, protected by identity and RBAC; PostgreSQL is private. Private endpoints for storage and Key Vault are a useful next exercise.
