<!-- written-by: writer-haiku | model: haiku -->
# Runbook: Incident — Cross-Tenant Data Leak

**Severity:** Critical  
**Duration:** Immediate containment (2 min) + 1 hour investigation  
**Trigger:** A user reports seeing another tenant's data, Langfuse shows cross-tenant rows, or a security scan finds RLS bypass.

---

## Overview

Stack's multi-tenant isolation is built on **four layers** (Spec 01 § 1):
1. Auth boundary (JWT carries `org_id`)
2. Repo guard (domain modules only accept `TxClient`, not raw connections)
3. Request-scoped `SET LOCAL app.tenant_id` (Postgres session-local variable)
4. **RLS `FORCE`** on every tenant table (the last line of defense)

This runbook covers immediate containment and investigation of a suspected cross-tenant leak.

**Critical principle:** If a user reports cross-tenant data access, assume the worst and lock down immediately.

---

## Immediate Containment (First 2 Minutes)

### 1. Assess the scope
- [ ] How many users reported the issue?
- [ ] What data was exposed? (book titles, member names, emails, holds, loans?)
- [ ] Is the issue still happening now?

**Example questions to ask the reporter:**
- "What data did you see from another organization?"
- "When did you first notice this?"
- "Is it still happening if you reload the page?"
- "Can you reproduce it reliably?"

### 2. Disable all AI features immediately
Even if the leak is not AI-related, disable them to reduce the blast radius:
```bash
vercel edge-config update $EDGE_CONFIG_TOKEN \
  feature.readers_advisor.enabled=false \
  feature.isbn_enrich.enabled=false \
  feature.catalog_search.enabled=false \
  feature.email_draft.enabled=false
```

**Rationale:** AI features are the most complex and least audited; they are the highest-risk vector for accidental cross-tenant leaks (e.g., a tool returning rows without filtering).

### 3. Notify stakeholders
- [ ] Slack `#security`: "CRITICAL: Suspected cross-tenant data leak. Containment in progress."
- [ ] Email security lead + platform lead + tech lead with the incident summary
- [ ] Do not post details in public Slack channels

### 4. Capture evidence
- [ ] Screenshot the leaked data the user saw
- [ ] Screenshot the URL they were on when they saw it
- [ ] Get the tenant IDs involved (if possible)
- [ ] Get the approximate time (to narrow log searches)

### 5. Check for cascading failures
```bash
# In Sentry, search for errors in the past 30 minutes:
# - "RLS policy"
# - "cross_tenant"
# - "permission denied"
# Any of these suggest the isolation layers are failing

# In Langfuse, filter traces for the past 30 minutes and look for:
# - API calls that reference multiple tenant_ids
# - Tool calls that returned rows from another tenant
```

---

## Investigation (Next 30 Minutes)

### 1. Determine the affected tenant pair
- Tenant A: The user who reported (exposed)
- Tenant B: The owner of the data they saw (leaked)

Get the tenant IDs:
```sql
-- In Neon, query the tenants table to find the slug/name
SELECT id, slug, name FROM tenants LIMIT 10;
-- Confirm which is A and which is B
```

### 2. Check RLS is enabled and enforced
```sql
-- For each tenant table, verify RLS is FORCED
SELECT schemaname, tablename, rowsecurity, relforcerowsecurity
FROM pg_class
WHERE schemaname = 'public' AND relkind = 'r';

-- Expected output: rowsecurity=true AND relforcerowsecurity=true for all tenant tables
-- If any table shows relforcerowsecurity=false, RLS is not enforced — CRITICAL
```

If any table has `relforcerowsecurity=false`, page the platform lead immediately. This is the most likely root cause.

### 3. Check the SET LOCAL mechanism
```sql
-- Simulate a cross-tenant query
SET LOCAL app.tenant_id = '<Tenant A ID>';
SELECT id, title FROM books WHERE tenant_id = '<Tenant B ID>';
-- Expected: 0 rows (RLS blocks it)

-- If rows are returned, RLS policy is broken
```

### 4. Audit recent SQL changes
- [ ] Check if any migrations or schema changes were deployed in the past 24 hours
- [ ] Look for: `ALTER TABLE ... DISABLE RLS`, `DROP POLICY`, changes to RLS predicates
- [ ] If found, this is likely the root cause

### 5. Search Langfuse for cross-tenant tool calls
```
Langfuse dashboard (production):
1. Filter by tenant_id = '<Tenant A ID>'
2. Filter by time range: last 1 hour
3. Look for any spans that reference '<Tenant B ID>' or have mismatched tenant tags
4. If found: the feature name (readers_advisor, isbn_enrich, etc.) is the culprit
```

### 6. Search Sentry for RLS errors
```
Sentry (production):
1. Search: error.type = "DatabaseError" AND message contains "RLS" OR "policy"
2. Filter by time: last 1 hour
3. Look for: "new row violates row-level security policy", "permission denied"
4. If found: the route handler or Server Action that triggered it is the culprit
```

---

## Diagnosis By Symptom

### Symptom A: User in Tenant A can query Tenant B's books directly

**Likely causes:**
1. RLS policy on `books` table is broken (or not enforced)
2. A Route Handler or Server Action bypassed `withTenantTx`
3. Someone disabled RLS with `ALTER TABLE ... DISABLE RLS` (check audit_log)

**Investigation:**
```sql
-- Check the books table RLS policy
SELECT * FROM pg_policies WHERE tablename = 'books';
-- Should show a policy with a WHERE clause like: tenant_id = current_setting('app.tenant_id')

-- If policy is missing, check the schema definition
\d books
-- Look for "Row Level Security:" line
```

### Symptom B: An AI feature (Reader's Advisor, search, etc.) returns Tenant B's data

**Likely causes:**
1. The feature's tool (e.g., `search_catalog`, `place_hold`) is missing a `tenant_id` filter in its query
2. The tool is called **outside** `withTenantTx` and `SET LOCAL` is not active
3. A new tool was added without going through the spec + eval + code-review process

**Investigation:**
```
Langfuse:
1. Find the AI call that leaked the data
2. Look at the tool invocation span:
   - Does it have tenant_id in its tags?
   - Does the tool response include rows from another tenant?
3. Open the code for the tool (lib/ai/tools/*.ts)
4. Check the query: does it filter by tenant_id?
```

### Symptom C: Tenant A's member can see Tenant B's hold queue

**Likely causes:**
1. A RSC or Route Handler is not using `withTenantTx`
2. A domain function is accepting tenant_id as a parameter (should reject it and use `ctx.tenantId` instead)
3. A cron job (e.g., `/api/cron/expire-holds`) is not re-establishing `SET LOCAL` after running

**Investigation:**
```
Code review:
1. Find the page/API route that returned the data (from the user's report)
2. Check if it uses withTenantTx:
   - RSC page: does it call withTenantTx(async (tx, ctx) => ...)?
   - Route Handler: same check
   - Cron route: does it call withTenantTx before any DB query?
3. Check if the query filters by tenant_id (or ctx.tenantId)
```

---

## Root Cause Resolution

### If RLS is disabled or broken
```sql
-- Re-enable RLS on all tenant tables
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE books FORCE ROW LEVEL SECURITY;
-- Repeat for: members, loans, holds, chat_threads, chat_messages, chat_refusals, email_batches, outgoing_emails, audit_log, ai_usage

-- Check the RLS policy
SELECT * FROM pg_policies WHERE tablename = 'books';
-- If the policy is missing, add it
CREATE POLICY books_tenant_isolation ON books
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Then deploy the fix as a migration (do not edit running production by hand).

### If a code path bypassed withTenantTx
- [ ] Find the path (from Langfuse or code review)
- [ ] Fix it to use `withTenantTx`
- [ ] Add a regression test (integration test that attempts cross-tenant query and expects 0 rows)
- [ ] Deploy the fix to production
- [ ] Verify in Sentry that the endpoint now blocks cross-tenant requests

### If a new tool was added without audit
- [ ] Check if the tool's queries filter by tenant_id
- [ ] Check if the tool is called only within `withTenantTx`
- [ ] If not, disable the feature via Edge Config kill switch
- [ ] Require a code review + eval + spec gate before re-enabling

---

## Post-Incident Actions

### 1. Audit all tenant data for leaks
```sql
-- For each tenant pair (A, B), check if A can see B's data
-- This is a manual spot-check; a full audit requires a CI job

-- Example: Can members in Tenant A see members in Tenant B?
SET LOCAL app.tenant_id = '<Tenant A ID>';
SELECT COUNT(*) FROM members WHERE tenant_id = '<Tenant B ID>';
-- Expected: 0
```

### 2. Enable the cross-tenant probe in all AI evals
- Verify that each AI feature's eval dataset includes a cross-tenant probe (Spec 11 REQ-11-06)
- Run the evals locally: `pnpm eval:gate`
- Confirm all probes pass (no cross-tenant rows returned)

### 3. Review CI gates
- [ ] Did the spec-gate, eval-gate, and cross-tenant-probe jobs run before this code was merged?
- [ ] If not, why did they not catch this? (CI skip? Feature flag?)
- [ ] Re-run CI on the problematic commit to confirm it now fails

### 4. Add a new integration test
```typescript
// tests/integration/cross-tenant-isolation.test.ts
it("refuses cross-tenant book access via RLS", async () => {
  const tenantA = await setupTestTenant();
  const tenantB = await setupTestTenant();
  
  // Insert a book in Tenant B
  const bookInB = await tenantB.db.insert(books).values({
    tenant_id: tenantB.tenantId,
    title: "Tenant B Book",
  }).returning();
  
  // Try to query it as Tenant A (should fail)
  const query = await tenantA.withTx((tx) =>
    tx.select().from(books).where(eq(books.id, bookInB[0].id))
  );
  
  expect(query).toHaveLength(0);  // RLS blocks it
});
```

### 5. Document the incident
- [ ] Write a post-incident review in `.claude/memory/bugs.md`
- [ ] Include: root cause, how it was missed, how to prevent similar issues
- [ ] Reference the PR that introduced the bug and the PR that fixed it

### 6. Re-enable AI features
Once the fix is deployed and verified:
```bash
vercel edge-config update $EDGE_CONFIG_TOKEN \
  feature.readers_advisor.enabled=true \
  feature.isbn_enrich.enabled=true \
  feature.catalog_search.enabled=true \
  feature.email_draft.enabled=true
```

---

## Checklist

**Containment (2 min):**
- [ ] Scope assessed (number of users, data type, ongoing?)
- [ ] All AI features disabled via kill switch
- [ ] Stakeholders notified (Slack + email)
- [ ] Evidence captured (screenshots, URLs, tenant IDs, time)

**Investigation (30 min):**
- [ ] RLS status checked (FORCE enabled on all tenant tables?)
- [ ] Affected tenant pair identified
- [ ] Langfuse traces reviewed for cross-tenant calls
- [ ] Sentry checked for RLS errors
- [ ] Recent schema changes audited

**Resolution (1 hour):**
- [ ] Root cause identified
- [ ] Fix deployed (migration, code change, or kill switch)
- [ ] Cross-tenant query manually tested (0 rows returned)
- [ ] CI gates run on the problematic commit (confirm they now fail)
- [ ] Integration test added to prevent regression

**Post-incident (next business day):**
- [ ] Full audit of tenant data completed
- [ ] Incident review written in .claude/memory/bugs.md
- [ ] Team debriefing scheduled
- [ ] Preventive measures implemented (new CI gate, new test, etc.)

---

## Escalation

- **RLS is disabled on a table:** Immediate page to platform lead + tech lead
- **Multiple tenants are affected:** Immediately take production offline until containment is achieved
- **Data was permanently deleted:** Page database owner + consider point-in-time recovery from Neon backup

---

## See also

- Spec 01 § 1 — four-layer isolation architecture
- Spec 01 NFR-01-02 — cross-tenant probe is a CI gate
- Spec 11 REQ-11-06 — cross-tenant probes in all AI eval sets
- `docs/analysis/04-multi-tenant-data-model.md` — RLS policy design
- `.claude/CLAUDE.md` § Multi-Tenancy — withTenantTx and RLS patterns
