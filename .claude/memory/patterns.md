# Reusable Patterns

<!-- Record reusable implementation patterns discovered during development. -->
<!-- Use /record-pattern to add entries via the slash command. -->

## Pattern: MediatR Validation Pipeline Behaviour

Register a `ValidationBehaviour<TRequest, TResponse>` that runs all `IValidator<TRequest>` implementations before the handler. Throws `ValidationException` (caught by global middleware → 400 ProblemDetails) if any rules fail.

**Key files**: `Application/Common/Behaviours/ValidationBehaviour.cs`

---

## Pattern: Clean Architecture DependencyInjection.cs per layer

Each project (`Application`, `Infrastructure`) exposes a static `DependencyInjection.cs` with an `AddXxxServices(this IServiceCollection, ...)` extension method. `Program.cs` in the Api project calls all three in order.

**Benefit**: Each layer owns its own registrations; no cross-layer DI knowledge leaks.

---

_Additional patterns will be appended here by /record-pattern._
