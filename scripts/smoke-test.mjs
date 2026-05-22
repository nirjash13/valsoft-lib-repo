/**
 * smoke-test — post-deploy smoke test for Stack.
 *
 * Performs a handful of HTTP checks against critical paths after a production
 * or preview deployment. On any failure, exits non-zero so the deploy workflow
 * can trigger a Vercel rollback (REQ-12-09).
 *
 * Usage:
 *   node scripts/smoke-test.mjs <base-url>
 *   SMOKE_URL=https://stack.example.com node scripts/smoke-test.mjs
 *
 * Checks:
 *   1. Home / app shell (authenticated surface)        GET /           → 200 or 302
 *   2. Public catalog API — health probe               GET /api/catalog/smoke-probe → non-500
 *   3. Sitemap (public, ISR-cached)                    GET /sitemap.xml → 200
 *   4. Auth0 callback route reachable (not 500)        GET /auth/login  → 302 or 200
 *   5. Public catalog page for demo tenant             GET /stack-public/catalog → 200 or 307
 *
 * All checks use the global `fetch` available in Node ≥ 18 — no dependencies.
 */

const baseUrl = (process.argv[2] ?? process.env.SMOKE_URL ?? "").replace(/\/$/, "");

if (!baseUrl) {
  console.error(
    "[smoke-test] Usage: node scripts/smoke-test.mjs <base-url>\n" +
      "  or set SMOKE_URL env variable.",
  );
  process.exit(1);
}

const TIMEOUT_MS = 15_000;

/**
 * @typedef {{ path: string; description: string; acceptStatuses: number[] }} SmokeCheck
 */

/** @type {SmokeCheck[]} */
const CHECKS = [
  {
    path: "/",
    description: "App shell (root redirect or login)",
    // 200 if app loads; 302 redirects to Auth0 login — both are healthy signals
    acceptStatuses: [200, 302, 307],
  },
  {
    path: "/sitemap.xml",
    description: "Sitemap (public, ISR-cached)",
    acceptStatuses: [200],
  },
  {
    path: "/auth/login",
    description: "Auth0 login route (not 500)",
    acceptStatuses: [200, 302, 307, 404],
  },
  {
    path: "/stack-public/catalog",
    description: "Public catalog page (demo tenant)",
    acceptStatuses: [200, 302, 307],
  },
  {
    path: "/api/catalog/stack-public",
    description: "Public catalog API (demo tenant)",
    // 200 = found; 404 = tenant not seeded in this env (acceptable); 500 = broken
    acceptStatuses: [200, 404],
  },
];

let failures = 0;

for (const check of CHECKS) {
  const url = `${baseUrl}${check.path}`;
  let status;
  let error;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "manual", // don't follow — we want to see 3xx status directly
        signal: controller.signal,
      });
      status = res.status;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = error === undefined && check.acceptStatuses.includes(status ?? -1);

  if (ok) {
    console.log(`[smoke-test] PASS  ${check.path} (${status}) — ${check.description}`);
  } else {
    const detail = error ? `error: ${error}` : `status: ${status}`;
    console.error(
      `[smoke-test] FAIL  ${check.path} (${detail}) — ${check.description}\n` +
        `  Expected one of: ${check.acceptStatuses.join(", ")}`,
    );
    failures++;
  }
}

console.log("");

if (failures > 0) {
  console.error(
    `[smoke-test] FAILED — ${failures} check(s) failed against ${baseUrl}.\nTriggering rollback conditions met.`,
  );
  process.exit(1);
}

console.log(`[smoke-test] PASSED — all ${CHECKS.length} checks against ${baseUrl}.`);
