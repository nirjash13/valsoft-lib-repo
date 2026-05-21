# .NET Stack Configuration

<!--
USAGE: This is the primary stack-specific reference for all agents working in this repository.
Project: Valsoft Library
Stack: .NET 9 / C# 13 / ASP.NET Core / Entity Framework Core
-->

## Token Discipline (mandatory)
- Do not ask me to paste long logs/dumps/configs into chat.
- If you need large output, instruct me to save it to a file and reference it with @path.
- If I paste >150 lines or >10k characters, stop and ask me to move it into a file, then continue once I provide @file.
- Prefer running commands with output redirected to a file (>, 2>, | tee) and then read that file.

## Always-Load Project Context
Before planning or coding, read:
- @architecture/system-model.yaml (when it exists)
- @CHANGELOG_AI.md

For human-readable overview: `architecture/architecture-summary.md`
For detailed quick reference: `architecture/architecture-compact.md`

If they are missing or stale relative to the latest changes, run /update-summary before proceeding.
When making changes that affect architecture, API contracts, DB schema, workflows, or module responsibilities, update the relevant architecture files in the same PR.

---

## Runtime & Tooling

| Component       | Choice                                      |
|-----------------|---------------------------------------------|
| Runtime         | .NET 9 (LTS)                                |
| Language        | C# 13                                       |
| Build Tool      | `dotnet CLI`                                |
| Package Manager | NuGet (`dotnet add package`)                |
| Test Runner     | xUnit                                       |
| Assertions      | FluentAssertions                            |
| Mocking         | NSubstitute (preferred) / Moq              |
| Coverage        | Coverlet + ReportGenerator                  |
| Linting/Format  | `dotnet format`, SonarAnalyzer (Roslyn)     |
| API Docs        | Swagger / Scalar (via Swashbuckle or Kiota) |
| ORM             | Entity Framework Core 9                     |
| Validation      | FluentValidation                            |
| Mediator        | MediatR (for CQRS)                          |
| HTTP Client     | `IHttpClientFactory` + `HttpClient`         |
| Resilience      | Polly v8 / Microsoft.Extensions.Resilience  |
| Auth            | ASP.NET Core Identity / JWT Bearer          |
| Logging         | `Microsoft.Extensions.Logging` + Serilog    |
| Config          | `IConfiguration` / `IOptions<T>` pattern    |

---

## Project Structure (Clean Architecture)

```
ValsoftLibrary/
├── src/
│   ├── ValsoftLibrary.Domain/          # Entities, value objects, domain events, interfaces
│   │   ├── Entities/
│   │   ├── ValueObjects/
│   │   ├── Events/
│   │   └── Exceptions/
│   ├── ValsoftLibrary.Application/     # Use cases, commands, queries, validators, DTOs
│   │   ├── Common/
│   │   │   ├── Interfaces/             # IRepository<T>, IUnitOfWork, etc.
│   │   │   └── Behaviours/             # MediatR pipeline behaviours (validation, logging)
│   │   ├── Features/
│   │   │   └── {FeatureName}/
│   │   │       ├── Commands/
│   │   │       └── Queries/
│   │   └── DependencyInjection.cs
│   ├── ValsoftLibrary.Infrastructure/  # EF Core, external services, repositories
│   │   ├── Persistence/
│   │   │   ├── ApplicationDbContext.cs
│   │   │   ├── Configurations/         # IEntityTypeConfiguration<T>
│   │   │   └── Repositories/
│   │   ├── Services/
│   │   └── DependencyInjection.cs
│   └── ValsoftLibrary.Api/             # ASP.NET Core host, controllers/minimal API endpoints
│       ├── Endpoints/
│       ├── Middleware/
│       ├── Program.cs
│       └── appsettings.json
├── tests/
│   ├── ValsoftLibrary.Domain.Tests/
│   ├── ValsoftLibrary.Application.Tests/
│   ├── ValsoftLibrary.Infrastructure.Tests/
│   └── ValsoftLibrary.Api.Tests/       # Integration tests via WebApplicationFactory
├── ValsoftLibrary.sln
└── README.md
```

---

## Naming Conventions

| Element              | Convention          | Example                          |
|----------------------|---------------------|----------------------------------|
| Namespaces           | PascalCase          | `ValsoftLibrary.Application`     |
| Classes / Interfaces | PascalCase          | `BookService`, `IBookRepository` |
| Interfaces           | `I` prefix          | `IBookRepository`                |
| Methods              | PascalCase          | `GetBookByIdAsync`               |
| Properties           | PascalCase          | `FirstName`                      |
| Private fields       | `_camelCase`        | `_bookRepository`                |
| Local variables      | camelCase           | `bookId`                         |
| Constants            | PascalCase          | `MaxRetryCount`                  |
| Async methods        | `Async` suffix      | `CreateBookAsync`                |
| Commands             | `{Verb}{Noun}Command` | `CreateBookCommand`            |
| Queries              | `{Verb}{Noun}Query`   | `GetBookByIdQuery`             |
| DTOs / Responses     | `{Noun}Dto` / `{Noun}Response` | `BookDto`, `BookResponse` |
| Validators           | `{Name}Validator`   | `CreateBookCommandValidator`     |

---

## Type Safety

### Required Patterns
```csharp
// ✅ Use nullable reference types (enabled in all projects)
#nullable enable

// ✅ Use record types for immutable value objects and DTOs
public record BookId(Guid Value);
public record CreateBookCommand(string Title, string Author, string Isbn) : IRequest<BookDto>;

// ✅ Use primary constructors (C# 12+)
public class BookService(IBookRepository repository, ILogger<BookService> logger)
{
    public async Task<BookDto> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        // ...
    }
}

// ✅ Use CancellationToken on all async methods
public async Task<IReadOnlyList<BookDto>> GetAllAsync(CancellationToken ct = default);

// ✅ Prefer IReadOnlyList / IReadOnlyCollection for return values
public IReadOnlyList<Book> GetByCategory(string category);
```

### Forbidden
```csharp
// ❌ Nullability pragma disabled
#nullable disable

// ❌ async void (except event handlers)
public async void ProcessAsync() { }  // Use async Task

// ❌ .Result or .Wait() — sync-over-async deadlock
var result = GetDataAsync().Result;   // Use await

// ❌ Catching Exception broadly without re-throwing
catch (Exception) { }                 // Too broad — catch specific exceptions

// ❌ Missing CancellationToken propagation
public async Task DoWorkAsync()       // Should accept CancellationToken ct
{
    await SomethingAsync();           // Should pass ct
}
```

---

## Error Handling

### Pattern: ProblemDetails + Domain Exceptions

```csharp
// Domain exception
public class BookNotFoundException : NotFoundException
{
    public BookNotFoundException(Guid id)
        : base($"Book with ID {id} was not found.") { }
}

public abstract class NotFoundException : Exception
{
    protected NotFoundException(string message) : base(message) { }
}

// Global exception middleware maps to ProblemDetails (RFC 7807)
// Program.cs:
app.UseExceptionHandler(builder => builder.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (statusCode, title) = exception switch
    {
        NotFoundException => (StatusCodes.Status404NotFound, "Not Found"),
        ValidationException => (StatusCodes.Status400BadRequest, "Validation Error"),
        _ => (StatusCodes.Status500InternalServerError, "Internal Server Error")
    };
    context.Response.StatusCode = statusCode;
    await context.Response.WriteAsJsonAsync(new ProblemDetails
    {
        Title = title,
        Status = statusCode,
        Detail = exception?.Message
    });
}));
```

### Result Pattern (for operations that can fail without exceptions)
```csharp
public class Result<T>
{
    public bool IsSuccess { get; }
    public T? Value { get; }
    public string? Error { get; }

    private Result(T value) { IsSuccess = true; Value = value; }
    private Result(string error) { IsSuccess = false; Error = error; }

    public static Result<T> Success(T value) => new(value);
    public static Result<T> Failure(string error) => new(error);
}
```

---

## Validation (FluentValidation)

```csharp
public class CreateBookCommandValidator : AbstractValidator<CreateBookCommand>
{
    public CreateBookCommandValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty()
            .MaximumLength(200);

        RuleFor(x => x.Author)
            .NotEmpty()
            .MaximumLength(100);

        RuleFor(x => x.Isbn)
            .NotEmpty()
            .Matches(@"^\d{13}$")
            .WithMessage("ISBN must be 13 digits.");
    }
}

// Wire up in MediatR pipeline behaviour (Application layer)
public class ValidationBehaviour<TRequest, TResponse>(
    IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request,
        RequestHandlerDelegate<TResponse> next, CancellationToken ct)
    {
        var context = new ValidationContext<TRequest>(request);
        var failures = validators
            .Select(v => v.Validate(context))
            .SelectMany(r => r.Errors)
            .Where(f => f != null)
            .ToList();

        if (failures.Count != 0)
            throw new ValidationException(failures);

        return await next();
    }
}
```

---

## Repository & EF Core Patterns

```csharp
// Generic repository interface (Application layer)
public interface IRepository<T> where T : BaseEntity
{
    Task<T?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<T>> GetAllAsync(CancellationToken ct = default);
    Task AddAsync(T entity, CancellationToken ct = default);
    void Update(T entity);
    void Delete(T entity);
}

// Entity configuration (Infrastructure layer)
public class BookConfiguration : IEntityTypeConfiguration<Book>
{
    public void Configure(EntityTypeBuilder<Book> builder)
    {
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Title).HasMaxLength(200).IsRequired();
        builder.Property(b => b.Isbn).HasMaxLength(13).IsRequired();
        builder.HasIndex(b => b.Isbn).IsUnique();
    }
}

// Unit of Work
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync(CancellationToken ct = default);
}
```

---

## Async Patterns

### Preferred
```csharp
// ✅ Always propagate CancellationToken
public async Task<Book> GetBookAsync(Guid id, CancellationToken ct = default)
{
    return await _context.Books.FirstOrDefaultAsync(b => b.Id == id, ct)
        ?? throw new BookNotFoundException(id);
}

// ✅ Use ConfigureAwait(false) in library/infrastructure code
var data = await _httpClient.GetFromJsonAsync<BookDto>(url, ct)
    .ConfigureAwait(false);

// ✅ Parallel async with Task.WhenAll
var (books, authors) = await (
    GetBooksAsync(ct),
    GetAuthorsAsync(ct)
).WhenAll();

// ✅ IHttpClientFactory over raw HttpClient
public class GoogleBooksClient(IHttpClientFactory factory)
{
    public async Task<BookInfo?> SearchAsync(string isbn, CancellationToken ct)
    {
        var client = factory.CreateClient("GoogleBooks");
        return await client.GetFromJsonAsync<BookInfo>($"/volumes?q=isbn:{isbn}", ct);
    }
}
```

### Forbidden
```csharp
// ❌ async void
public async void OnButtonClick() { }    // Use async Task, or event handler pattern

// ❌ Sync-over-async
var result = GetBooksAsync().Result;     // Deadlock risk on ASP.NET

// ❌ Swallowing OperationCanceledException
catch (OperationCanceledException) { }   // Must re-throw or log + re-throw

// ❌ Fire-and-forget without error handling
_ = Task.Run(() => DoSomething());       // Use IHostedService or channels instead
```

---

## Testing (xUnit + FluentAssertions + NSubstitute)

### Unit Test Structure
```csharp
// tests/ValsoftLibrary.Application.Tests/Features/Books/GetBookByIdQueryHandlerTests.cs
public class GetBookByIdQueryHandlerTests
{
    private readonly IBookRepository _repository = Substitute.For<IBookRepository>();
    private readonly GetBookByIdQueryHandler _sut;

    public GetBookByIdQueryHandlerTests()
    {
        _sut = new GetBookByIdQueryHandler(_repository);
    }

    [Fact]
    public async Task Handle_WhenBookExists_ReturnsBookDto()
    {
        // Arrange
        var bookId = Guid.NewGuid();
        var book = new Book { Id = bookId, Title = "Clean Code", Author = "Robert Martin" };
        _repository.GetByIdAsync(bookId, Arg.Any<CancellationToken>()).Returns(book);

        // Act
        var result = await _sut.Handle(new GetBookByIdQuery(bookId), CancellationToken.None);

        // Assert
        result.Should().NotBeNull();
        result.Title.Should().Be("Clean Code");
    }

    [Fact]
    public async Task Handle_WhenBookNotFound_ThrowsBookNotFoundException()
    {
        // Arrange
        var bookId = Guid.NewGuid();
        _repository.GetByIdAsync(bookId, Arg.Any<CancellationToken>()).Returns((Book?)null);

        // Act
        var act = () => _sut.Handle(new GetBookByIdQuery(bookId), CancellationToken.None);

        // Assert
        await act.Should().ThrowAsync<BookNotFoundException>();
    }
}
```

### Integration Test Structure (WebApplicationFactory)
```csharp
// tests/ValsoftLibrary.Api.Tests/Books/BooksEndpointTests.cs
public class BooksEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetBook_WhenExists_Returns200WithBody()
    {
        // Act
        var response = await _client.GetAsync($"/api/books/{TestData.ExistingBookId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<BookDto>();
        body!.Title.Should().NotBeEmpty();
    }
}
```

---

## Common Commands

```bash
# Build & Run
dotnet build                            # Build solution
dotnet run --project src/ValsoftLibrary.Api  # Run API
dotnet watch --project src/ValsoftLibrary.Api  # Hot reload

# Testing
dotnet test                             # Run all tests
dotnet test --filter "Category=Unit"    # Filter tests
dotnet test --collect:"XPlat Code Coverage" -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=lcov  # Coverage
dotnet test -v normal                   # Verbose output

# Code Quality
dotnet format                           # Format code
dotnet format --verify-no-changes       # CI check (no changes allowed)
dotnet build -warnaserror               # Treat warnings as errors

# Packages
dotnet add package FluentValidation     # Add package
dotnet list package --vulnerable        # Check for vulnerabilities
dotnet list package --outdated          # Check for updates

# EF Core Migrations
dotnet ef migrations add InitialCreate --project src/ValsoftLibrary.Infrastructure --startup-project src/ValsoftLibrary.Api
dotnet ef database update --project src/ValsoftLibrary.Infrastructure --startup-project src/ValsoftLibrary.Api
dotnet ef migrations script             # Generate SQL script for production
```

---

## Framework-Specific

### ASP.NET Core Minimal API Endpoints
```csharp
// src/ValsoftLibrary.Api/Endpoints/BooksEndpoints.cs
public static class BooksEndpoints
{
    public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/books")
            .WithTags("Books")
            .RequireAuthorization();

        group.MapGet("/", GetAllBooks).WithName("GetAllBooks");
        group.MapGet("/{id:guid}", GetBookById).WithName("GetBookById");
        group.MapPost("/", CreateBook).WithName("CreateBook");
        group.MapPut("/{id:guid}", UpdateBook).WithName("UpdateBook");
        group.MapDelete("/{id:guid}", DeleteBook).WithName("DeleteBook");

        return app;
    }

    private static async Task<IResult> GetBookById(
        Guid id, ISender mediator, CancellationToken ct)
    {
        var result = await mediator.Send(new GetBookByIdQuery(id), ct);
        return Results.Ok(result);
    }

    private static async Task<IResult> CreateBook(
        CreateBookCommand command, ISender mediator, CancellationToken ct)
    {
        var id = await mediator.Send(command, ct);
        return Results.CreatedAtRoute("GetBookById", new { id }, null);
    }
}
```

### Dependency Injection Registration
```csharp
// Application/DependencyInjection.cs
public static class DependencyInjection
{
    public static IServiceCollection AddApplicationServices(
        this IServiceCollection services)
    {
        services.AddMediatR(cfg =>
            cfg.RegisterServicesFromAssembly(Assembly.GetExecutingAssembly()));

        services.AddValidatorsFromAssembly(Assembly.GetExecutingAssembly());

        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehaviour<,>));
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehaviour<,>));

        return services;
    }
}

// Infrastructure/DependencyInjection.cs
public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructureServices(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<ApplicationDbContext>(options =>
            options.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

        services.AddScoped<IBookRepository, BookRepository>();
        services.AddScoped<IUnitOfWork, UnitOfWork>();

        return services;
    }
}
```
