-- Rollback for 0018_grant_reporting_to_app_role.
-- Revokes the application role's access to the `reporting` schema.

ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  REVOKE EXECUTE ON FUNCTIONS FROM stack_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA reporting
  REVOKE SELECT ON TABLES FROM stack_app;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA reporting FROM stack_app;

REVOKE SELECT ON ALL TABLES IN SCHEMA reporting FROM stack_app;

REVOKE USAGE ON SCHEMA reporting FROM stack_app;
