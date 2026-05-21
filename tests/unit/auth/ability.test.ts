import { buildAbility } from "@/lib/auth/ability";
import { describe, expect, it } from "vitest";

/**
 * Load-bearing tests for buildAbility().
 *
 * `buildAbility` takes the JWT `roles[]` claim and resolves it through the
 * ROLE_PERMISSIONS table in `lib/auth/permission.ts`. Each test exercises a
 * behaviour that would cause a real security failure if broken:
 *
 *   1. tenant_admin role grants privileged operations (book:delete, tenant:settings).
 *   2. member role is scoped — book:read allowed, book:create denied.
 *   3. Unknown role names are tolerated — no throw, no rights granted (forward-compat).
 *   4. member role never bleeds into Tenant subject (cross-subject deny).
 *
 * Load-bearing per testing.md: a regression breaks authorization for real users
 * and causes either access denial (test 1) or unauthorized access (tests 2, 4).
 */
describe("buildAbility", () => {
  it("tenant_admin role grants book:delete and tenant:settings", () => {
    // These are the two highest-stakes permissions a tenant_admin holds.
    // A regression here either locks admins out of catalog management or
    // fails the CASL gate that would prevent members from deleting books.
    const ability = buildAbility(["tenant_admin"]);

    expect(ability.can("delete", "Book")).toBe(true);
    expect(ability.can("settings", "Tenant")).toBe(true);
  });

  it("member role grants book:read but denies book:create", () => {
    // Members are readers, not curators. Granting create would allow any member
    // to pollute the catalog — a user-visible security boundary.
    const ability = buildAbility(["member"]);

    expect(ability.can("read", "Book")).toBe(true);
    expect(ability.can("create", "Book")).toBe(false);
  });

  it("unknown role name is tolerated with no throw and grants no ability", () => {
    // Forward-compat: if Auth0 adds a new role before this code is deployed,
    // we must not crash. The unknown role must also NOT grant any access.
    // If this threw, every user whose JWT contains a future role would lock out.
    let ability: ReturnType<typeof buildAbility> | undefined;
    expect(() => {
      ability = buildAbility(["future_unknown_role", "member"]);
    }).not.toThrow();

    // Known role still works
    expect(ability?.can("read", "Book")).toBe(true);
    // Unknown role granted nothing extra
    expect(ability?.can("read", "AuditLog")).toBe(false);
  });

  it("system_owner role grants auditlog:read (parsePermission AuditLog title-case)", () => {
    // Regression for the title-case bug: rawSubject.charAt(0).toUpperCase() +
    // .slice(1).toLowerCase() produced "Auditlog" (lowercase L), which did not
    // match KNOWN_SUBJECTS' "AuditLog". parsePermission returned null and the
    // permission was silently dropped, with only a console.warn surfacing it.
    // The fix special-cases "auditlog" → "AuditLog" the same way "ai" → "AI".
    const ability = buildAbility(["system_owner"]);

    expect(ability.can("read", "AuditLog")).toBe(true);
  });

  it("member role does not bleed into Tenant subject (cross-subject deny)", () => {
    // If member ever granted tenant:settings, any reader could change library
    // settings. This is a security incident, not a bug.
    const ability = buildAbility(["member"]);

    expect(ability.can("settings", "Tenant")).toBe(false);
    expect(ability.can("provision", "Tenant")).toBe(false);
    expect(ability.can("delete", "Book")).toBe(false);
  });
});
