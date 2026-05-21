# Architectural Decisions

<!-- Record significant architectural decisions here. -->
<!-- Use /record-decision to add entries via the slash command. -->

## D-2026-05-21 — Adopt Clean Architecture

**Decision**: Use Clean Architecture (four-project layout: Domain, Application, Infrastructure, Api).

**Rationale**: Clean Architecture provides strong separation of concerns, makes domain logic independently testable, and prevents infrastructure concerns (EF Core, HTTP clients) from leaking into business logic. Well-supported by the .NET ecosystem.

**Alternatives Considered**:
- Vertical Slice Architecture — rejected as premature for this project; revisit if feature count grows large
- Simple layered (Controllers → Services → Repositories) — rejected as it tends to degrade into an anemic domain model

**Status**: Active

---

## D-2026-05-21 — .NET 9 / MediatR CQRS stack

**Decision**: .NET 9, ASP.NET Core Minimal APIs, EF Core 9, MediatR for CQRS, FluentValidation, xUnit + FluentAssertions + NSubstitute.

**Rationale**: .NET 9 is the current LTS-adjacent release with the best performance characteristics. MediatR keeps handlers small and focused. FluentValidation is the de facto standard for validation. xUnit is the community standard for .NET testing.

**Status**: Active

---

_Additional decisions will be appended here by /record-decision._
