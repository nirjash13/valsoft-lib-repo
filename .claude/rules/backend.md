# Backend Rules

## Scope
Applies when editing backend implementation under `src/**` (Domain, Application, Infrastructure, Api projects).

## Architecture Boundaries (Clean Architecture — mandatory)

The dependency rule: **inner layers must never reference outer layers.**

```
Domain ← Application ← Infrastructure
Domain ← Application ← Api
```

- **Domain**: Entities, value objects, domain events, domain exceptions, repository *interfaces*. No EF Core, no MediatR, no external packages.
- **Application**: Use cases (commands/queries), validators, DTOs, application service interfaces. References Domain only.
- **Infrastructure**: EF Core, repository implementations, external service clients, migrations. References Application + Domain.
- **Api**: Controllers/endpoints, middleware, DI wiring, `Program.cs`. References Application + Infrastructure (DI only).

### Forbidden Cross-Layer References
```
❌ Domain referencing Application or Infrastructure
❌ Application referencing Infrastructure (except via interfaces)
❌ Domain entities with EF Core attributes (use Fluent API configurations)
❌ Direct DbContext usage in Application layer handlers (use IRepository / IUnitOfWork)
```

## Standards
- Validate all external input at the Application layer boundary (FluentValidation + MediatR pipeline behaviour).
- Use `IRepository<T>` for all data access — no `DbContext` directly in handlers.
- Use `CancellationToken` on every async method signature.
- Handle async operations with proper cancellation propagation — no `.Result`, `.Wait()`.
- Use `DateTimeOffset.UtcNow` not `DateTime.Now`.
- Use `IOptions<T>` / `IOptionsSnapshot<T>` for configuration — no `IConfiguration` in handlers.

## Verification
- Run `dotnet build -warnaserror` — zero warnings tolerated.
- Run targeted `dotnet test --filter` for changed behavior.
- Run `dotnet format --verify-no-changes` before marking done.

## References
- `.claude/CLAUDE.md` for full .NET stack patterns and naming conventions.
- `.claude/constitution.md` for immutable project rules.
