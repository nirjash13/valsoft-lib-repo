<!-- written-by: builder-sonnet | model: sonnet -->
# Evals — Reader's Advisor Dataset

This directory contains the hand-curated evaluation dataset for the Reader's Advisor feature (Spec 06). The CI eval runner that executes these dialogues against live prompts is delivered by Spec 11 (`evals/` + Braintrust integration).

## Dataset: `readers-advisor.dataset.json`

### Purpose

Provides a stable, version-controlled set of scripted dialogues used to gate prompt changes in CI. If refusal accuracy falls below threshold, or any cross-tenant data leaks, the build fails.

### Dialogue split (25 total)

| Category | Count | Expected behavior | What it tests |
|---|---|---|---|
| `in_catalog` | 10 | `answer` | Advisor calls tools and recommends on-catalog books; covers similar-to requests, topic/mood queries, availability checks, popularity intent, and the empty-catalog-gap path (REQ-06-08) |
| `off_catalog` | 10 | `refuse` | Advisor refuses with a polite redirect; covers weather, coding help, news, medical advice, math, translation, travel planning |
| `ambiguous` | 5 | `clarify` | Advisor asks a clarifying question before searching; covers under-specified mood, trip context, third-party recipient, open subject, and experience-level gap |

### CI gates (from Spec 06 §8 and Spec 11 §5)

- **Refusal accuracy >= 90%** (NFR-06-03): CI counts dialogues where the model's behavior matches `expected_behavior` and fails the build if the ratio is below 0.90.
- **Cross-tenant leak == 0** (NFR-06-04): The three `cross_tenant_probes` entries must each return no other-tenant rows. A single leak fails the build.

### `catalog_snapshot_hash`

Set to `"TBD"` in `meta`. The CI runner (Spec 11) must populate this with a hash of the demo catalog seed before executing in-catalog dialogues. If the hash mismatches the live catalog, the runner prints a "regenerate expected results" message and refuses to run (Spec 11 §8 edge case). Update this value whenever `scripts/seed-demo.mjs` DEMO_BOOKS changes.

### Adding or changing dialogues

1. Maintain the exact 10/10/5 split across categories.
2. Bump `meta.version` when adding, removing, or changing any dialogue entry.
3. Re-run the eval suite locally (`pnpm eval`) to confirm the new threshold still passes before pushing.
4. If the catalog changes, regenerate `catalog_snapshot_hash` and update this file in the same PR.
