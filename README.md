# Valsoft Library

A .NET 9 library management application built with Clean Architecture.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | .NET 9 / C# 13 |
| API | ASP.NET Core Minimal APIs |
| Architecture | Clean Architecture |
| ORM | Entity Framework Core 9 |
| CQRS | MediatR |
| Validation | FluentValidation |
| Testing | xUnit + FluentAssertions + NSubstitute |
| Logging | Serilog |

## Project Structure

```
ValsoftLibrary/
├── src/
│   ├── ValsoftLibrary.Domain/           # Entities, value objects, domain logic
│   ├── ValsoftLibrary.Application/      # Use cases, commands, queries, DTOs
│   ├── ValsoftLibrary.Infrastructure/   # EF Core, repositories, external services
│   └── ValsoftLibrary.Api/              # ASP.NET Core host, endpoints
└── tests/
    ├── ValsoftLibrary.Application.Tests/
    └── ValsoftLibrary.Api.Tests/
```

## Getting Started

### Prerequisites
- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- A database (PostgreSQL or SQL Server — see configuration)

### Run locally

```bash
dotnet restore
dotnet build
dotnet run --project src/ValsoftLibrary.Api
```

### Run tests

```bash
dotnet test
```

### Apply migrations

```bash
dotnet ef database update --project src/ValsoftLibrary.Infrastructure --startup-project src/ValsoftLibrary.Api
```

## Development

See [`.claude/WORKFLOW_GUIDE.md`](.claude/WORKFLOW_GUIDE.md) for the AI-assisted development workflow.
See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for coding standards and conventions.
