/**
 * Domain errors for the public catalog (Spec 09).
 */

/**
 * Thrown when a tenant's public catalog is disabled (publicCatalogEnabled === false).
 * Maps to HTTP 404 at the API layer (REQ-09-05).
 */
export class CatalogDisabledError extends Error {
  override readonly name = "CatalogDisabledError";

  constructor(tenantSlug: string) {
    super(`Public catalog is disabled for tenant "${tenantSlug}".`);
  }
}

/**
 * Thrown when a public book lookup finds no matching non-blocked book.
 * Maps to HTTP 404 at the API layer.
 */
export class PublicBookNotFoundError extends Error {
  override readonly name = "PublicBookNotFoundError";

  constructor(bookId: string) {
    super(`Book "${bookId}" not found in the public catalog.`);
  }
}

/**
 * Thrown when the tenant slug does not match any tenant.
 * Maps to HTTP 404 at the API layer.
 */
export class TenantNotFoundError extends Error {
  override readonly name = "TenantNotFoundError";

  constructor(slug: string) {
    super(`No tenant found with slug "${slug}".`);
  }
}
