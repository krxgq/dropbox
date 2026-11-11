-- Run as the configured Entra operator against the postgres database first.
-- psql -v app_object_id='<managedIdentityObjectId output>' -d postgres -f infra/bootstrap.sql
\set ON_ERROR_STOP on
SELECT * FROM pg_catalog.pgaadauth_create_principal_with_oid(
  'dropbox-app', :'app_object_id', 'service', false, false
);
\connect dropbox
-- Apply migrations as the operator, never as the runtime identity.
\ir ../sql/001-initial.sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE dropbox FROM PUBLIC;
GRANT CONNECT ON DATABASE dropbox TO "dropbox-app";
GRANT USAGE ON SCHEMA public TO "dropbox-app";
GRANT SELECT ON users, files TO "dropbox-app";
-- Registration cannot choose or update a role, even with SQL access as this identity.
GRANT INSERT (id, name, email, password_hash) ON users TO "dropbox-app";
GRANT INSERT ON files TO "dropbox-app";
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO "dropbox-app";
