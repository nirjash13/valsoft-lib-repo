import { withSystemTenantTx } from "@/lib/db/with-system-tenant-tx";
import { requirePublicCatalog } from "@/lib/domain/catalog/resolve-tenant-by-slug";
import { getPublicBook } from "@/lib/domain/catalog/service";
import { coverGradient } from "@/lib/utils/cover-color";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const alt = "Book preview image";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

/**
 * Dynamic Open Graph image generator (REQ-09-04).
 *
 * Renders at 1200x630 for standard social unfurling.
 */
export default async function OgImage({
  params,
}: {
  params: Promise<{ tenant: string; bookId: string }>;
}) {
  const { tenant: slug, bookId } = await params;

  try {
    // 1. Resolve tenant config
    const config = await requirePublicCatalog(slug);

    // 2. Fetch the book (safe public view)
    const book = await withSystemTenantTx(config.tenantId, (tx) =>
      getPublicBook(tx, bookId, config.publicCatalogSubjectBlocklist),
    );

    const gradient = coverGradient(book.title);

    return new ImageResponse(
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#0d0f12", // HSL 220 13% 7%
          padding: "80px",
          color: "#f5f5f7",
        }}
      >
        {/* Left: Book Cover / Fallback */}
        <div
          style={{
            display: "flex",
            width: "300px",
            height: "400px",
            borderRadius: "16px",
            overflow: "hidden",
            position: "relative",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            backgroundColor: "#16181d",
          }}
        >
          {book.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverUrl}
              alt={book.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            // Typographic fallback cover
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                width: "100%",
                height: "100%",
                background: gradient,
                padding: "24px",
              }}
            >
              <div
                style={{
                  fontSize: "28px",
                  fontWeight: "bold",
                  color: "rgba(255, 255, 255, 0.95)",
                  marginBottom: "8px",
                  lineHeight: "1.2",
                }}
              >
                {book.title}
              </div>
              <div
                style={{
                  fontSize: "18px",
                  color: "rgba(255, 255, 255, 0.6)",
                }}
              >
                {book.authors[0] ?? "Unknown"}
              </div>
            </div>
          )}
        </div>

        {/* Right: Book Metadata & Library Details */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: "660px",
            height: "400px",
            paddingLeft: "50px",
          }}
        >
          {/* Library brand chip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              padding: "6px 14px",
              borderRadius: "100px",
              backgroundColor: "rgba(59, 130, 246, 0.12)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              color: "#60a5fa", // accent blue
              fontSize: "14px",
              fontWeight: "bold",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "24px",
            }}
          >
            {config.tenantName}
          </div>

          {/* Book Title */}
          <div
            style={{
              fontSize: "44px",
              fontWeight: "bold",
              color: "#ffffff",
              lineHeight: "1.2",
              marginBottom: "16px",
              maxHeight: "160px",
              overflow: "hidden",
            }}
          >
            {book.title}
          </div>

          {/* Authors */}
          <div
            style={{
              fontSize: "24px",
              color: "#a1a1aa", // text-secondary
              marginBottom: "24px",
            }}
          >
            by {book.authors.join(", ")}
          </div>

          {/* Platform / Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "auto",
              color: "#52525b",
              fontSize: "14px",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontWeight: "bold",
            }}
          >
            <span>Powered by Stack Library</span>
          </div>
        </div>
      </div>,
      {
        ...size,
      },
    );
  } catch (_err) {
    // If anything fails, render a generic stack-branded OG image
    return new ImageResponse(
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0d0f12",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            fontSize: "48px",
            fontWeight: "bold",
            color: "#3b82f6",
            marginBottom: "16px",
          }}
        >
          Stack
        </div>
        <div
          style={{
            fontSize: "24px",
            color: "#a1a1aa",
          }}
        >
          Discover and Borrow Books
        </div>
      </div>,
      {
        ...size,
      },
    );
  }
}
