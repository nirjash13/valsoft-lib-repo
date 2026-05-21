<!-- written-by: writer-haiku | model: haiku -->
# Design Notes — [Feature Name]

**Date:** ___________  
**Status:** Draft — Ready for Stage 3  
**Requirements Doc:** [link to requirements doc] ___________  
**Author(s):** ___________

> **Important:** This stage is human-only. Do not use AI to generate the design.
> The goal is for the team to make deliberate architectural choices before AI validates them in Stage 3.

---

## Data Model

> Sketch the core entities and their relationships. Use words, pseudocode, or a table.
> Do not implement — just capture what data exists and how it relates.

### Entities

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| ___________ | ___________ | ___________ |
| ___________ | ___________ | ___________ |
| ___________ | ___________ | ___________ |

### Relationships

```
[Entity A] ──has many──> [Entity B]
[Entity A] ──has one──>  [Entity C] (if [condition])
```

---

## Flow

> Describe the happy path and failure paths step by step.

### Happy Path

1. ___________
2. ___________
3. ___________
4. ___________
5. ___________

### Failure / Edge Path

1. ___________
2. ___________
3. ___________

---

## Integration Points

> What external systems, services, or APIs does this feature touch?

| System | How it communicates | Notes |
|--------|---------------------|-------|
| ___________ | REST / Webhook / Queue / Polling / Other | ___________ |
| ___________ | | |
| ___________ | | |

---

## UI Sketch (if applicable)

> Low-fidelity only. Describe or sketch: what information is shown, who sees it, what interactions are needed.
> Attach a photo of a whiteboard sketch or Lucidchart link if available.

**Who sees this UI:** ___________

**Information shown:**
- ___________
- ___________
- ___________

**Interactions:**
- ___________
- ___________

**Sketch / Link:** ___________

---

## Design Decisions

> Why did you choose this shape? Document your reasoning so AI can validate it in Stage 3.

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| ___________ | ___________ | ___________ |
| ___________ | ___________ | ___________ |
| ___________ | ___________ | ___________ |

---

## Constraints This Design Must Respect

> Things that cannot be changed regardless of what looks "better" in isolation.

- ___________
- ___________
- ___________

---

## Ready for Stage 3 Checklist

- [ ] Data model sketched (entities + relationships)
- [ ] Happy path documented step by step
- [ ] At least one failure path documented
- [ ] Integration points identified
- [ ] UI sketch done (if applicable)
- [ ] Design decisions and rationale written
- [ ] Constraints listed

**Tech Lead sign-off:** ___________  
**Date:** ___________

> Next step: Run `/spec-requirements [path-to-this-file] [path-to-requirements-doc]` to generate the spec.
