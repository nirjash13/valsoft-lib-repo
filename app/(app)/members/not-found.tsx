import { Users } from "lucide-react";
import Link from "next/link";

/**
 * Members section not-found boundary.
 */
export default function MembersNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center max-w-[600px] mx-auto">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "hsl(212 40% 18%)" }}
        aria-hidden
      >
        <Users className="h-8 w-8 text-accent" />
      </div>
      <h1 className="text-h1 text-text-primary mb-2">Member not found</h1>
      <p className="text-body text-text-secondary mb-6">
        The member you are looking for does not exist or has been removed.
      </p>
      <Link href="/members" className="text-body text-accent hover:underline underline-offset-2">
        Back to members
      </Link>
    </div>
  );
}
