<!-- written-by: builder-sonnet | model: sonnet -->
# Evals — AI Evaluation Suite

This directory contains the hand-curated evaluation datasets and the CI runner for all AI features (Spec 11 REQ-11-05, REQ-11-06, NFR-11-03/04/05).

---

## Running the suite

```bash
# Run evals (skips cleanly when AI_GATEWAY_API_KEY is absent)
pnpm eval
# equivalent: node evals/run-evals.mjs

# CI gate mode — exits non-zero on failure
pnpm eval:gate
# equivalent: node evals/run-evals.mjs --gate

# Print the current catalog_snapshot_hash (use when updating the catalog fixture)
node evals/run-evals.mjs --print-hash
```

**Required environment variables** (only needed for real runs):

| Variable | Description |
|---|---|
| `AI_GATEWAY_API_KEY` | Bearer token for the eval endpoint. Absent → suite prints SKIPPED and exits 0. |
| `EVAL_BASE_URL` | Base URL of the deployed app (default: `http://localhost:3000`). |

---

## Runner behaviour

### Without `AI_GATEWAY_API_KEY`

Prints:
```
SKIPPED — AI_GATEWAY_API_KEY not set (evals require a live gateway).
Set AI_GATEWAY_API_KEY and EVAL_BASE_URL to run against a real deployment.
```
Exits 0. CI continues. This keeps the suite honest — no faked scores.

### With `AI_GATEWAY_API_KEY`

1. Loads every `evals/*.dataset.json`.
2. Validates `catalog_snapshot_hash` against `evals/fixtures/catalog-snapshot.json`.
3. Validates dataset shape and thresholds.
4. Runs all cross-tenant probes (fail-closed: any errored or non-OK probe is a hard gate failure per REQ-11-06).
5. **Model-quality scenario execution is not yet wired** — the `/api/evals/run` endpoint is not implemented. The runner prints a `[SKIPPED]` notice for scenarios and does not produce false scores. To enforce model-quality gates, implement `app/api/evals/run` or integrate the Braintrust SDK.
6. In `--gate` mode: exits non-zero if any cross-tenant probe leaks data or cannot be verified.

---

## Gate failure messages

| Message | Meaning |
|---|---|
| `eval gate: <feature> <metric> <score> < <threshold>` | Feature scored below threshold; lists failing scenario IDs. |
| `cross_tenant_leak: N row(s) from other tenant in N probe(s)` | A cross-tenant probe returned other-tenant data (REQ-11-06). |
| `cross_tenant_probe_unverified: N probe(s) could not be verified` | A probe returned non-OK or was unreachable — isolation unconfirmed; hard failure (REQ-11-06). |
| `[SKIP] catalog_snapshot_hash mismatch` | Dataset hash stale — see Snapshot Hash below. |

---

## Dataset schema

Each `*.dataset.json` file has:

```jsonc
{
  "meta": {
    "feature": "readers_advisor",      // snake_case feature name
    "version": "1.0",                  // bump when adding/changing scenarios
    "metric": "refusal_accuracy",      // scoring metric key
    "threshold": 0.90,                 // CI gate threshold (0.0–1.0)
    "cross_tenant_leak_threshold": 0,  // always 0 — any leak fails
    "catalog_snapshot_hash": "670117d53fe31fbe",  // see Snapshot Hash
    "note": "..."
  },
  "scenarios": [                       // (or "dialogues" for readers-advisor)
    {
      "id": "unique-id",
      "category": "in_catalog | off_catalog | ambiguous | ...",
      "input": "...",                  // user message / query
      "expected_behavior": "answer | refuse | clarify | ...",
      "rationale": "..."
    }
  ],
  "cross_tenant_probes": [
    {
      "id": "cross-01",
      "input": "...",
      "expected_behavior": "no_cross_tenant_data",
      "rationale": "..."
    }
  ]
}
```

---

## Datasets and thresholds

| Dataset file | Feature | Metric | Threshold | Spec |
|---|---|---|---|---|
| `readers-advisor.dataset.json` | `readers_advisor` | `refusal_accuracy` | 0.90 | Spec 06 / REQ-11-05 |
| `search.dataset.json` | `search` | `ndcg_at_5` | 0.65 | Spec 05 |
| `isbn-enrich.dataset.json` | `isbn_enrich` | `field_accuracy` | 0.90 | Spec 02 |
| `reporting.dataset.json` | `reporting` | `parse_accuracy` | 0.90 | Spec 08 |

Aggregate refusal accuracy across all features must be ≥ 0.90 (NFR-11-05). The runner computes and gates this automatically.

---

## Snapshot hash

The `catalog_snapshot_hash` in each dataset guards against eval drift — if the demo catalog changes but the expected results don't, in-catalog scenarios will fail silently. The hash is computed over the `books` array in `evals/fixtures/catalog-snapshot.json`.

**To regenerate after a catalog change:**

1. Update `evals/fixtures/catalog-snapshot.json` to reflect the new demo books.
2. Run `node evals/run-evals.mjs --print-hash` to get the new hash.
3. Update `catalog_snapshot_hash` in every `*.dataset.json` that uses the catalog.
4. Re-run in-catalog scenarios locally to confirm expected results still hold.
5. Include the fixture + all dataset changes in the same PR.

---

## Adding or changing scenarios

1. Match the schema above.
2. Bump `meta.version` in the affected dataset file.
3. Each dataset must include at least one `cross_tenant_probes` entry.
4. Run `pnpm eval` locally to confirm the suite passes before pushing.
5. If adding scenarios that depend on catalog data, confirm the `catalog_snapshot_hash` is current.

---

## Cross-tenant probes (REQ-11-06)

Every dataset has at least one cross-tenant probe scenario. The runner POSTs each probe to `/api/evals/cross-tenant-probe` and expects `{ leaked_rows: 0 }`.

**Fail-closed policy:** any errored, non-OK, or unreachable probe response is treated as `cross_tenant_probe_unverified` and causes a hard gate failure in `--gate` mode. A probe that errors is NOT silently treated as "no leak".

**Current status:** `/api/evals/cross-tenant-probe` is not yet implemented in this repo. Until it is, all probes will be `unverified` and will fail the gate. This is intentional — failing closed is safer than passing open per REQ-11-06.

A data leak fails the build with:
```
cross_tenant_leak: N row(s) from other tenant in N probe(s)
```

An unreachable endpoint fails the build with:
```
cross_tenant_probe_unverified: N probe(s) could not be verified — isolation unconfirmed
```

This catches RLS regressions that are otherwise invisible — e.g. a refactor that drops `tenant_id` from a WHERE clause would pass unit tests but fail the cross-tenant probe.
