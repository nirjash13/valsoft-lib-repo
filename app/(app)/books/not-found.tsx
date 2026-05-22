import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * 404 page for the books route segment.
 */
export default function BooksNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-h3 text-text-primary mb-2">Book not found</p>
      <p className="text-body text-text-secondary mb-6">
        This book may have been deleted or the link is incorrect.
      </p>
      <Button asChild>
        <Link href="/books">Back to Books</Link>
      </Button>
    </div>
  );
}
