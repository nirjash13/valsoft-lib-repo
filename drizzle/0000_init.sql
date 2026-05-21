-- =============================================================================
-- Migration: 0000_init
-- Description: Initial schema — tenants, tenant_memberships, members, audit_log.
--              RLS FORCE policies for every tenant-scoped table.
-- Apply with: pnpm drizzle-kit migrate (uses DATABASE_URL_UNPOOLED for direct connection)
-- Rollback:   drizzle/0000_init.down.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- Required extensions: pgcrypto (gen_random_uuid). pgvector deferred to Spec 05.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- pgvector is deferred until Spec 05 (search) to avoid requiring the extension
-- on environments that don't have it installed yet.

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
-- Not tenant-scoped (no tenant_id column, no RLS).
-- Access is gated by tenant_memberships (policy added in Run B).

CREATE TABLE tenants (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_org_id          text          NOT NULL UNIQUE,
  name                  text          NOT NULL,
  slug                  text          NOT NULL UNIQUE,
  brand_voice           text,
  ai_monthly_cap_usd    numeric(10,2) NOT NULL DEFAULT 50.00,
  loan_duration_days    integer       NOT NULL DEFAULT 14,
  hold_pickup_hours     integer       NOT NULL DEFAULT 72,
  max_renewals          integer       NOT NULL DEFAULT 2,
  public_catalog_enabled boolean      NOT NULL DEFAULT false,
  created_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_slug_idx ON tenants (slug);

-- ---------------------------------------------------------------------------
-- tenant_memberships
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_memberships (
  tenant_id   uuid    NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id     text    NOT NULL,
  role        text    NOT NULL,
  status      text    NOT NULL DEFAULT 'active',
  joined_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, user_id),

  CONSTRAINT tenant_memberships_role_check
    CHECK (role IN ('system_owner', 'tenant_admin', 'librarian', 'member', 'guest')),

  CONSTRAINT tenant_memberships_status_check
    CHECK (status IN ('active', 'pending', 'rejected', 'suspended'))
);

CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx ON tenant_memberships (user_id);

-- RLS — tenant_memberships is scoped: a user's memberships for other tenants are hidden.
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_tenant_isolation ON tenant_memberships
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------

CREATE TABLE members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  auth0_user_id text,
  display_name  text        NOT NULL,
  email         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT members_tenant_email_unique UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS members_tenant_idx    ON members (tenant_id);
CREATE INDEX IF NOT EXISTS members_auth0_uid_idx ON members (auth0_user_id) WHERE auth0_user_id IS NOT NULL;

-- RLS
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;

CREATE POLICY members_tenant_isolation ON members
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- audit_log  (REQ-01-06)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            bigserial   PRIMARY KEY,
  tenant_id     uuid        NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  actor_id      text        NOT NULL,
  action        text        NOT NULL,
  subject_type  text        NOT NULL,
  subject_id    uuid,
  before_json   jsonb,
  after_json    jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_occurred_idx ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_subject_idx         ON audit_log (tenant_id, subject_type, subject_id);

-- RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING  (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Append-only invariant (NFR-01-03): defense-in-depth REVOKE for non-superuser roles.
-- Note: REVOKE FROM PUBLIC is bypassed by the table owner (migration role). The trigger
-- below is the actual enforcement — it fires regardless of role ownership.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

-- Append-only enforcement (NFR-01-03): a BEFORE trigger that raises on UPDATE or DELETE.
-- This works regardless of role ownership — REVOKE FROM PUBLIC alone is bypassed by the
-- migration role / table owner per Postgres semantics.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

-- =============================================================================
-- Rollback: drizzle/0000_init.down.sql
-- =============================================================================
