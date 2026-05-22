import { ChatThread } from "@/components/chat/chat-thread";
import { isFeatureEnabled } from "@/lib/flags";
import { notFound } from "next/navigation";

interface ChatPageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * Chat page — "Ask Stack" conversational surface.
 *
 * Server Component. Reads ?q= to support ⌘K handoff (Builder F):
 * the initialQuery is passed to ChatThread which auto-sends it once on mount.
 *
 * Feature-gated: 404 when readers_advisor flag is OFF (REQ-06-10).
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const advisorEnabled = await isFeatureEnabled("readers_advisor");
  if (!advisorEnabled) {
    notFound();
  }

  const params = await searchParams;
  // Trim and validate the query; pass undefined if absent to avoid empty auto-send
  const rawQuery = params.q?.trim();
  const initialQuery = rawQuery && rawQuery.length > 0 ? rawQuery : undefined;

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Full-height layout: remove the p-6 from the parent main and use h-full */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle bg-surface shrink-0">
        <h1 className="text-h2 text-text-primary font-semibold">Ask Stack</h1>
        <span className="text-meta text-text-tertiary">· Reading advisor powered by AI</span>
      </header>

      <ChatThread initialQuery={initialQuery} pageContext="global" className="flex-1 min-h-0" />
    </div>
  );
}

export const metadata = {
  title: "Ask Stack — Reading Advisor",
};
