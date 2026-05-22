<!-- written-by: writer-haiku | model: haiku -->
# Runbook: AI Feature Kill Switch

**Severity:** High  
**Duration:** 5–10 minutes  
**Trigger:** An AI feature is misbehaving (hallucinating, returning sensitive data, or degrading UX) and needs immediate disabling without a code deploy.

---

## Overview

Every AI feature in Stack (Reader's Advisor, ISBN enrichment, search, notifications drafts) has an **Edge Config kill switch** that can be flipped without redeploying. This runbook walks you through disabling a misbehaving feature and verifying the change took effect.

**Key principle:** You do not need to redeploy. The flag is global-edge-cached and propagates to all Vercel nodes within seconds.

---

## Prerequisite

You must have access to the Vercel dashboard for the Stack project:
- `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` from GitHub repo secrets or local `.env.local`
- Or direct access to the Vercel dashboard

---

## Steps

### 1. Confirm the feature is enabled
```bash
vercel env ls
# Look for EDGE_CONFIG_TOKEN
```
If `EDGE_CONFIG_TOKEN` is not in the output, ask the platform lead for the token.

### 2. Identify the misbehaving feature
Common AI features in Stack:
- `readers_advisor` — conversational chat with book recommendations
- `isbn_enrich` — ISBN-to-book enrichment via Open Library + Google Books
- `catalog_search` — hybrid semantic + lexical search
- `email_draft` — AI draft for notification emails

**Note:** Feature names are **lowercase with underscores**, e.g., `readers_advisor` not `ReaderAdvisor`.

### 3. Disable the feature globally
**Via Vercel CLI** (preferred):
```bash
vercel edge-config update EDGE_CONFIG_TOKEN feature.<name>.enabled false
# Example:
vercel edge-config update $EDGE_CONFIG_TOKEN feature.readers_advisor.enabled false
```

**Via Vercel dashboard** (manual):
1. Go to [Vercel](https://vercel.com) → Your project → Settings → Edge Config
2. Find the token labeled `EDGE_CONFIG_TOKEN`
3. Click to view its contents
4. Add or edit the key: `feature.<name>.enabled: false`
5. Save and deploy the change

### 4. Verify the flag is set
```bash
vercel edge-config ls $EDGE_CONFIG_TOKEN
# Output should include: feature.readers_advisor.enabled: false
```

### 5. Test the feature is blocked in production
- **UI:** Navigate to the feature's entry point (e.g., ⌘K for Reader's Advisor) and confirm it is hidden or disabled.
- **API:** Send a test request to the feature's API endpoint:
  ```bash
  curl -X POST https://stack.vercel.app/api/chat/stream \
    -H "Authorization: Bearer <test-token>" \
    -H "Content-Type: application/json" \
    -d '{"messages": [{"role": "user", "content": "test"}]}'
  # Expected: 404 Not Found (not 200)
  ```

### 6. Record the incident
- [ ] Note the time the feature was disabled (timestamp in UTC)
- [ ] Add a line to the **incident log** (ask the platform lead for the log location)
- [ ] Paste the symptom: e.g., "Reader's Advisor was hallucinating off-catalog book titles"

### 7. Investigate root cause (do not block disabling)
Once the feature is disabled and production is safe:
1. Open **Langfuse** (link in the prod dashboard) and filter traces for the feature + the past hour
2. Look for error patterns, high token counts, or unusual refusal behavior
3. Check **Sentry** for application errors on the feature's routes
4. Review the **latest prompt version** in `lib/ai/prompts/<feature>.md`

### 8. Notify stakeholders
- [ ] Slack: Post in `#incidents` with the feature name, time disabled, and status
- [ ] Email: Notify the AI reviewer and the platform lead with initial findings

### 9. Plan fix
- [ ] If the issue is a **prompt regression**, the fix is a prompt-file version bump + eval-gate pass (see ADR-0001)
- [ ] If the issue is a **tool or routing problem**, the fix requires a code change + deploy
- [ ] Do not re-enable the feature until the fix is merged and tested in preview

---

## Per-Tenant Kill Switch (Advanced)

To disable a feature for a **single tenant only** (not globally):

```bash
vercel edge-config update $EDGE_CONFIG_TOKEN feature.<name>.<tenant_id>.enabled false
# Example: feature.readers_advisor.f3d96d5e-dd55-4e72-a545-e7322eb8a359.enabled false
```

The system checks `feature.<name>.<tenant_id>.enabled` first, then falls back to `feature.<name>.enabled`. This is useful for isolating a misbehaving tenant without affecting others.

---

## Re-enabling the feature

Once the fix is deployed:
```bash
vercel edge-config update $EDGE_CONFIG_TOKEN feature.<name>.enabled true
```

Verify:
1. The flag is set to `true`
2. The feature's entry point reappears in the UI
3. Test the feature end-to-end
4. Confirm Langfuse shows new traces (not old cached responses)

---

## Checklist

- [ ] Feature name identified
- [ ] Flag set to `false` via `vercel edge-config update`
- [ ] Flag verified with `vercel edge-config ls`
- [ ] UI entry point is hidden or disabled
- [ ] API endpoint returns 404
- [ ] Incident logged with timestamp
- [ ] Langfuse traces reviewed
- [ ] Root cause hypothesis documented
- [ ] Stakeholders notified

---

## Rollback

If you accidentally disabled the wrong feature or need to re-enable immediately:
```bash
vercel edge-config update $EDGE_CONFIG_TOKEN feature.<wrong-name>.enabled true
```

No code deploy required.

---

## See also

- Spec 11 REQ-11-04 — kill switch requirements
- Spec 11 REQ-11-08 — friendly failure messages
- [ADR-0001 — Eval-as-CI-Gate](../docs/decisions/0001-eval-as-ci-gate.md) — how eval gates catch AI regressions in CI, preventing production incidents
