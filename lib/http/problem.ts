/**
 * RFC 7807 ProblemDetails response helper.
 *
 * Used by Route Handlers (not Server Actions — those use next-safe-action's
 * serverError envelope). Clients can inspect the `Content-Type: application/problem+json`
 * header and parse the body to display user-facing messages.
 */

export function problem(status: number, title: string, detail?: string, code?: string): Response {
  return Response.json(
    {
      type: "about:blank",
      title,
      status,
      ...(detail !== undefined ? { detail } : {}),
      ...(code !== undefined ? { code } : {}),
    },
    {
      status,
      headers: { "Content-Type": "application/problem+json" },
    },
  );
}
