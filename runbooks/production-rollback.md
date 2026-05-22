<!-- written-by: writer-haiku | model: haiku -->
# Runbook: Production Rollback

**Severity:** Critical  
**Duration:** 2–5 minutes (automatic) + 5 minutes verification  
**Trigger:** A production deploy has introduced a critical bug (failed smoke tests, data corruption, widespread user-visible failure) and must be rolled back immediately.

---

## Overview

Stack's production deployment is automated via Vercel. When a PR is merged to `main`, `deploy-prod.yml` runs:
1. Deploys the new code to Vercel
2. Runs a post-deploy smoke test
3. **Automatically rolls back if the smoke test fails** (within 90 seconds)

This runbook covers both the automatic rollback path and the manual rollback procedure if automatic rollback fails.

---

## Automatic Rollback (Expected Path)

### 1. Monitor the deployment

In **GitHub**:
1. Go to your repo → Actions
2. Find the most recent "Deploy to Production" workflow run
3. Watch the job logs in real time

In **Vercel**:
1. Go to the project dashboard
2. Watch the "Deployments" tab
3. The most recent deployment should show "Building" → "Ready" → "Test" (smoke tests)

### 2. If smoke tests pass
- The deployment is complete and live
- Continue to verification (step 5 below)

### 3. If smoke tests fail
- GitHub Actions will automatically trigger a rollback via Vercel's promotion API
- You will see: "Automatic rollback triggered — promoting previous production deployment"
- **Wait for completion** — rollback takes 30–90 seconds
- A Slack notification will confirm: "Production rollback complete; previous version restored"

### 4. Verify the rollback

```bash
# Get the current production URL
vercel ls --prod
# Should show the PREVIOUS commit hash, not the new one that failed

# Smoke test the rolled-back URL manually
curl https://stack.vercel.app
# Should return a 200 with valid HTML
```

---

## Manual Rollback (If Automatic Fails)

Use this only if automatic rollback did not trigger or did not complete.

### 1. Access Vercel

**Via CLI:**
```bash
vercel login  # if not logged in
vercel ls --prod
# Output lists all deployments; identify the previous stable one
```

**Via dashboard:**
1. Go to [vercel.com](https://vercel.com) → Your project → Deployments
2. Find the most recent stable deployment (the one before the broken one)
3. Click "Promote to Production"

### 2. Promote the previous deployment

**Via CLI:**
```bash
# List deployments and find the stable one
vercel ls --limit 5

# Promote the stable deployment (replace <DEPLOYMENT_ID> with the commit hash or deployment ID)
vercel promote <DEPLOYMENT_ID>
# Example: vercel promote abc1234def5678
```

**Via dashboard:**
1. Right-click the stable deployment
2. Select "Promote to Production"
3. Confirm

### 3. Wait for promotion
- The promotion takes 30–60 seconds
- DNS propagation may take up to 60 more seconds
- Vercel will update the "Production" label in the deployments list

### 4. Verify the rollback
```bash
# Confirm the URL points to the stable deployment
curl -I https://stack.vercel.app
# Look for the deployment ID in the response headers (x-vercel-deployment-id)
# It should match the deployment you promoted
```

---

## Post-Rollback Investigation

Once production is stable:

### 1. Gather information
- [ ] Screenshot the failed deploy's logs (GitHub Actions or Vercel)
- [ ] Note the exact error message from smoke tests
- [ ] Check **Sentry** for errors in the failed deployment's time window
- [ ] Check **Langfuse** for AI call failures
- [ ] Note the deployment ID and commit hash that failed

### 2. Review the change
- [ ] Go to GitHub and view the commit that caused the rollback
- [ ] Check if there are **recent related changes** in the same area
- [ ] Look for **database migration issues** (did a migration fail to apply?)
- [ ] Look for **environment variable misconfigurations** (was a secret missing?)

### 3. Determine the root cause
- **Smoke test failure** — Open the test logs; most failures point to a specific endpoint or error
- **Data corruption** — Verify the database is not corrupted; check `psql` logs
- **Environment mismatch** — Confirm all secrets and env vars are set in Vercel
- **Dependency issue** — Check if a new npm dependency has a known issue

### 4. Create a fix
- [ ] Open a new branch
- [ ] Fix the issue (code change, migration rollback, secret update, etc.)
- [ ] Test locally and in a preview deployment
- [ ] Create a PR with a clear title: "Fix: [brief description of rollback cause]"
- [ ] Get approval
- [ ] Merge to `main`

### 5. Re-deploy
- [ ] Merging to `main` automatically triggers `deploy-prod.yml`
- [ ] Monitor the deployment in GitHub Actions
- [ ] Verify smoke tests pass
- [ ] Confirm the new version is live in Vercel

---

## Database Migration Rollback (Destructive Migration)

If the rollback is because a **database migration failed or caused data loss**:

1. **Do not re-apply the same migration** — investigate first
2. **Consult the migration's rollback plan** — the PR that added the migration should have documented how to roll it back
3. **Contact the database owner** — if data was deleted, recovery may require a backup or manual correction
4. **Check Neon** — Neon keeps 24-hour backups; if needed, Neon support can restore a point-in-time snapshot

---

## Checklist

- [ ] Smoke test failure identified (automatic or manual review)
- [ ] Automatic rollback triggered (or manual promotion executed)
- [ ] Previous deployment confirmed as `Production` in Vercel
- [ ] URL smoke-tested manually (200 response, valid HTML)
- [ ] Slack notification sent to team
- [ ] Root cause identified
- [ ] Fix committed to `main`
- [ ] New deploy monitoring started
- [ ] Post-incident review scheduled

---

## Escalation

- **Rollback is not completing:** Page the on-call DevOps lead (Slack: `#deployments`)
- **Database is corrupted:** Page the platform lead (Slack: `#platform`)
- **Multiple rollbacks in one day:** Escalate to the tech lead; something systemic is wrong

---

## Prevention

- Pre-merge: Ensure **all required CI checks pass** (spec-gate, eval-gate, typecheck, unit tests, e2e tests)
- Pre-deploy: Monitor the preview deployment + Neon preview branch smoke tests
- Post-merge: Monitor the production deployment logs in Vercel for 5 minutes after the workflow completes
- Monitor: Set up Sentry + Langfuse alerts for critical errors in production

---

## See also

- Spec 12 REQ-12-09 — automated rollback and smoke-test gate
- Spec 12 NFR-12-05 — rollback must complete in ≤ 90 seconds
- `.github/workflows/deploy-prod.yml` — the automation that handles this
