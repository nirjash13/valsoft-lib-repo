import { merge } from "@/lib/domain/books/sources/merge";
import { describe, expect, it } from "vitest";

describe("merge", () => {
  it("Open Library wins when both sources have the same field (OL precedence rule)", () => {
    const ol = { title: "Clean Code (OL)", authors: ["Robert Martin"] };
    const gb = { title: "Clean Code (GB)", authors: ["Robert C. Martin"] };

    const { merged } = merge(ol, gb);

    expect(merged.title).toBe("Clean Code (OL)");
    expect(merged.authors).toEqual(["Robert Martin"]);
  });

  it("Google Books fills gaps when Open Library is missing a field", () => {
    const ol = { title: "Clean Code", authors: ["Robert Martin"] };
    // OL has no year, GB has year 2008
    const gb = { title: "Clean Code", year: 2008, publisher: "Prentice Hall" };

    const { merged } = merge(ol, gb);

    // OL title wins; GB fills year and publisher since OL omitted them
    expect(merged.title).toBe("Clean Code");
    expect(merged.year).toBe(2008);
    expect(merged.publisher).toBe("Prentice Hall");
  });

  it("populates sourcesDiff when OL and GB disagree on year (REQ-02-01 BDD)", () => {
    // Spec BDD: "OL returns year=2008, GB returns year=2009 → preview shows year=2008 with hint"
    const ol = { title: "Clean Code", year: 2008 };
    const gb = { title: "Clean Code", year: 2009 };

    const { merged, sourcesDiff } = merge(ol, gb);

    // OL wins: merged year = 2008
    expect(merged.year).toBe(2008);
    // sourcesDiff carries the disagreement for the UI hint
    expect(sourcesDiff.year).toEqual({ ol: 2008, gb: 2009 });
  });
});
