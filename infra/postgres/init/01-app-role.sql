-- Local development bootstrap. Production environments provision the
-- equivalent role/extension through the hosting provider's migration
-- tooling, not this file.

CREATE EXTENSION IF NOT EXISTS vector;

-- app_user is the role the running API connects as. It is deliberately
-- NOT the owner of any table and has NOSUPERUSER / NOBYPASSRLS, so
-- Row Level Security policies are enforced against every query it runs.
-- Migrations run as the `postgres` superuser and own the tables; that
-- ownership split is what makes RLS apply without needing
-- `FORCE ROW LEVEL SECURITY` on every table.
CREATE ROLE app_user WITH LOGIN PASSWORD 'app_user_dev_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE csa_dev TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO app_user;

-- auth_resolver exists to break one specific chicken-and-egg problem:
-- resolving a raw widget API key to its owning workspace_id has to happen
-- BEFORE the request has a tenant context, so it cannot go through the
-- normal RLS-enforced app_user path. It is intentionally BYPASSRLS, but
-- migrations grant it SELECT on nothing but the workspace_api_keys table
-- (see packages/db migrations) so the blast radius of that bypass is a
-- single narrow, auditable query rather than the whole schema.
CREATE ROLE auth_resolver WITH LOGIN PASSWORD 'auth_resolver_dev_password' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE csa_dev TO auth_resolver;
GRANT USAGE ON SCHEMA public TO auth_resolver;

-- platform_operator is a second, deliberately separate BYPASSRLS role
-- for the Platform Owner Dashboard - not an extension of auth_resolver.
-- auth_resolver exists for one-shot, pre-tenant-context lookups (an API
-- key or slug resolved before a request has a workspace to scope a query
-- with); platform_operator is for an already-authenticated platform
-- admin's ongoing, repeated, cross-tenant reads/writes (list/suspend any
-- workspace, provision a new one). Its grants (see the migrations)
-- are just as narrow, but keeping the two roles separate keeps each
-- one's audit story - who can reach it, and why - clean.
CREATE ROLE platform_operator WITH LOGIN PASSWORD 'platform_operator_dev_password' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE csa_dev TO platform_operator;
GRANT USAGE ON SCHEMA public TO platform_operator;
