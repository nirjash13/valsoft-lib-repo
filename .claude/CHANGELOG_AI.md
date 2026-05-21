# AI Changelog — Valsoft Library

<!-- Machine-maintained changelog. Updated by /update-summary after significant changes. -->
<!-- Format: ## YYYY-MM-DD — Short Title -->
<!-- Each entry: what changed, files affected, decisions made. -->

## 2026-05-21 — Project Bootstrap

- Initialized `.claude` setup for .NET 9 / Clean Architecture
- Adapted agent pipeline from Python/FastAPI to .NET (CLAUDE.md, builder-sonnet, critic-opus, new dotnet-reviewer)
- Established initial architecture decisions: Clean Architecture, MediatR CQRS, EF Core 9, xUnit
- Memory system initialized with clean state
