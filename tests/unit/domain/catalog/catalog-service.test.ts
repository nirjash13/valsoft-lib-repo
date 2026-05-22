import type { TxClient } from "@/lib/db/with-tenant-tx";
import {
  CatalogDisabledError,
  PublicBookNotFoundError,
  TenantNotFoundError,
} from "@/lib/domain/catalog/errors";
import {
  clearTenantCatalogCache,
  requirePublicCatalog,
  resolveTenantBySlug,
} from "@/lib/domain/catalog/resolve-tenant-by-slug";
import type { PublicBook } from "@/lib/domain/catalog/schemas";
import { getPublicBook, listPublicBooks } from "@/lib/domain/catalog/service";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 1. Mock owner-pool before importing anything that connects to DB
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
};

vi.mock("@/lib/db/owner-pool", () => ({
  getOwnerPool: () => mockPool,
}));

function serializeSqlChunks(query: unknown): string {
  if (!query) return "";
  if (typeof query === "string" || typeof query === "number") return String(query);
  if (Array.isArray(query)) {
    return query.map(serializeSqlChunks).join("");
  }
  if (typeof query === "object") {
    const qObj = query as Record<string, unknown>;
    if ("queryChunks" in qObj) {
      return serializeSqlChunks(qObj.queryChunks);
    }
    if ("value" in qObj && Array.isArray(qObj.value)) {
      return qObj.value.join("");
    }
  }
  return "";
}

describe("Public Catalog Domain Service & Slug Resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTenantCatalogCache();
  });

  describe("resolveTenantBySlug & requirePublicCatalog", () => {
    it("successfully resolves tenant config from DB and caches it", async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            id: "tenant-123",
            name: "Library A",
            public_catalog_enabled: true,
            public_catalog_subject_blocklist: ["restricted", "adult"],
          },
        ],
      });

      const config = await resolveTenantBySlug("library-a");

      expect(config).toEqual({
        tenantId: "tenant-123",
        tenantName: "Library A",
        publicCatalogEnabled: true,
        publicCatalogSubjectBlocklist: ["restricted", "adult"],
      });

      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "SELECT id, name, public_catalog_enabled, public_catalog_subject_blocklist",
        ),
        ["library-a"],
      );

      // Call it again to verify cache
      const cachedConfig = await resolveTenantBySlug("library-a");
      expect(cachedConfig).toEqual(config);
      // Connect should still only have been called once due to caching
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
    });

    it("throws TenantNotFoundError if tenant does not exist", async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      await expect(resolveTenantBySlug("nonexistent")).rejects.toThrow(TenantNotFoundError);
    });

    it("requirePublicCatalog throws CatalogDisabledError if catalog is disabled", async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            id: "tenant-123",
            name: "Library A",
            public_catalog_enabled: false,
            public_catalog_subject_blocklist: [],
          },
        ],
      });

      await expect(requirePublicCatalog("library-a")).rejects.toThrow(CatalogDisabledError);
    });

    it("requirePublicCatalog succeeds if catalog is enabled", async () => {
      mockClient.query.mockResolvedValue({
        rows: [
          {
            id: "tenant-123",
            name: "Library A",
            public_catalog_enabled: true,
            public_catalog_subject_blocklist: [],
          },
        ],
      });

      const config = await requirePublicCatalog("library-a");
      expect(config.publicCatalogEnabled).toBe(true);
    });
  });

  describe("listPublicBooks", () => {
    const mockBooks = [
      {
        id: "book-1",
        tenant_id: "tenant-123",
        isbn13: "1111111111111",
        title: "Clean Code",
        authors: ["Robert C. Martin"],
        year: 2008,
        publisher: "Prentice Hall",
        page_count: 464,
        subjects: ["Software Engineering", "Programming"],
        language: "english",
        cover_url: "https://example.com/cover1.jpg",
        description: "A handbook of agile software craftsmanship",
        updated_at: "2026-05-22T00:00:00Z",
        availability_status: "available",
        loan_due_at: null,
        hold_count: 0,
      },
      {
        id: "book-2",
        tenant_id: "tenant-123",
        isbn13: "2222222222222",
        title: "Fifty Shades",
        authors: ["E. L. James"],
        year: 2011,
        publisher: "Vintage Books",
        page_count: 514,
        subjects: ["Adult Fiction", "Romance"],
        language: "english",
        cover_url: "https://example.com/cover2.jpg",
        description: "A romance novel",
        updated_at: "2026-05-22T00:00:00Z",
        availability_status: "on_loan",
        loan_due_at: "2026-06-01T12:00:00Z",
        hold_count: 2,
      },
    ];

    it("lists all books and applies mapping correctly", async () => {
      const mockTx = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const queryStr = serializeSqlChunks(query);
          if (queryStr.includes("COUNT")) {
            return { rows: [{ count: 2 }] };
          }
          return { rows: mockBooks };
        }),
      } as unknown as TxClient;

      const result = await listPublicBooks(mockTx, { limit: 10, offset: 0 }, []);
      expect(result.totalCount).toBe(2);
      expect(result.books).toHaveLength(2);
      expect(result.books[0]).toEqual({
        id: "book-1",
        isbn13: "1111111111111",
        title: "Clean Code",
        authors: ["Robert C. Martin"],
        year: 2008,
        subjects: ["Software Engineering", "Programming"],
        language: "english",
        coverUrl: "https://example.com/cover1.jpg",
        description: "A handbook of agile software craftsmanship",
        availability: {
          status: "available",
          dueAt: null,
          holdCount: 0,
        },
      });
    });

    it("REQ-09-06: filters out books having blocked subjects in list (defense-in-depth)", async () => {
      const mockTx = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const queryStr = serializeSqlChunks(query);
          if (queryStr.includes("COUNT")) {
            return { rows: [{ count: 2 }] };
          }
          return { rows: mockBooks };
        }),
      } as unknown as TxClient;

      const result = await listPublicBooks(mockTx, { limit: 10, offset: 0 }, ["Adult Fiction"]);
      // book-2 has subject 'Adult Fiction', so it should be filtered out by application layer blocklist
      expect(result.books).toHaveLength(1);
      expect(result.books[0]?.id).toBe("book-1");
    });

    it("REQ-09-03: executes tsquery lexical search and does not invoke AI", async () => {
      const mockTx = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const queryStr = serializeSqlChunks(query);
          if (queryStr.includes("COUNT")) {
            return { rows: [{ count: 1 }] };
          }
          return { rows: [mockBooks[0]] };
        }),
      } as unknown as TxClient;

      const result = await listPublicBooks(mockTx, { q: "Clean Code", limit: 10, offset: 0 }, []);
      expect(result.books).toHaveLength(1);

      const calls = vi.mocked(mockTx.execute).mock.calls;
      const dataQuerySql = serializeSqlChunks(calls[0]?.[0]);
      expect(dataQuerySql).toContain("websearch_to_tsquery");
    });
  });

  describe("getPublicBook", () => {
    const mockBookRow = {
      id: "book-1",
      tenant_id: "tenant-123",
      isbn13: "1111111111111",
      title: "Clean Code",
      authors: ["Robert C. Martin"],
      year: 2008,
      publisher: "Prentice Hall",
      page_count: 464,
      subjects: ["Software Engineering", "Programming"],
      language: "english",
      cover_url: "https://example.com/cover1.jpg",
      description: "A handbook of agile software craftsmanship",
      updated_at: "2026-05-22T00:00:00Z",
      availability_status: "available",
      loan_due_at: null,
      hold_count: 0,
    };

    it("successfully fetches single book detail", async () => {
      const mockTx = {
        execute: vi.fn().mockResolvedValue({ rows: [mockBookRow] }),
      } as unknown as TxClient;

      const book = await getPublicBook(mockTx, "book-1", []);
      expect(book).toEqual({
        id: "book-1",
        isbn13: "1111111111111",
        title: "Clean Code",
        authors: ["Robert C. Martin"],
        year: 2008,
        publisher: "Prentice Hall",
        pageCount: 464,
        subjects: ["Software Engineering", "Programming"],
        language: "english",
        coverUrl: "https://example.com/cover1.jpg",
        description: "A handbook of agile software craftsmanship",
        updatedAt: "2026-05-22T00:00:00Z",
        availability: {
          status: "available",
          dueAt: null,
          holdCount: 0,
        },
      });
    });

    it("throws PublicBookNotFoundError when book is not found", async () => {
      const mockTx = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as TxClient;

      await expect(getPublicBook(mockTx, "nonexistent", [])).rejects.toThrow(
        PublicBookNotFoundError,
      );
    });

    it("REQ-09-06: throws PublicBookNotFoundError when book has a blocked subject (defense-in-depth)", async () => {
      const mockTx = {
        execute: vi.fn().mockResolvedValue({ rows: [mockBookRow] }),
      } as unknown as TxClient;

      await expect(getPublicBook(mockTx, "book-1", ["Programming"])).rejects.toThrow(
        PublicBookNotFoundError,
      );
    });
  });

  describe("NFR-09-03: No PII in output shapes (compile-time assertion)", () => {
    it("ensures PublicBook fields do not leak user/membership/audit details", () => {
      const book: PublicBook = {
        id: "id",
        isbn13: "isbn",
        title: "title",
        authors: ["author"],
        year: 2026,
        subjects: [],
        language: "en",
        coverUrl: "url",
        description: "desc",
        availability: {
          status: "available",
          dueAt: null,
          holdCount: 0,
        },
      };

      // @ts-expect-error - memberId should not exist
      book.memberId;
      // @ts-expect-error - borrowerName should not exist
      book.borrowerName;
      // @ts-expect-error - createdBy should not exist
      book.createdBy;

      expect(book).toBeDefined();
    });
  });
});
