# Migration Rules

## Scope
Applies when editing EF Core migrations under `src/ValsoftLibrary.Infrastructure/Migrations/**` and related model/configuration code.

## Rules
- Keep one logical schema change per migration when possible.
- Include a safe `Down()` migration unless explicitly not supported (document why).
- Validate migration against current entity configurations before committing.
- Generate migrations with: `dotnet ef migrations add <Name> --project src/ValsoftLibrary.Infrastructure --startup-project src/ValsoftLibrary.Api`
- Always test `dotnet ef database update` and rollback (`dotnet ef database update <PreviousMigration>`) before marking done.
- Note any contract or data-impacting changes in the changelog.

## Safety
- Never modify already-applied production migrations — create a new migration instead.
- Treat data migrations (populating/transforming rows) as high-risk. Document rollback strategy explicitly.
- Generate SQL script for production deployments: `dotnet ef migrations script --idempotent`
