/**
 * Batch patron reminder email template.
 *
 * Used for AI-drafted or librarian-written patron emails sent in bulk.
 * The body is a pre-rendered / pre-interpolated HTML string (markdown-to-html
 * converted by the caller) that is injected inside the shared layout shell.
 *
 * Always includes `unsubscribeUrl` per lifecycle email convention (REQ/US-08).
 */

import { Section, Text } from "@react-email/components";
import { Layout } from "./layout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BatchReminderProps {
  /** Personalised subject line (pre-interpolated per recipient). */
  subjectLine: string;
  /**
   * Pre-rendered HTML string (markdown converted to HTML by the caller via a
   * library such as `marked`). Injected inside the layout body.
   *
   * The caller is responsible for sanitising this HTML before passing it in.
   */
  bodyHtml: string;
  libraryName: string;
  unsubscribeUrl: string;
}

// ---------------------------------------------------------------------------
// BatchReminder
// ---------------------------------------------------------------------------

export function BatchReminder({
  subjectLine,
  bodyHtml,
  libraryName,
  unsubscribeUrl,
}: BatchReminderProps) {
  return (
    <Layout libraryName={libraryName} preview={subjectLine} unsubscribeUrl={unsubscribeUrl}>
      {/* Render the pre-interpolated HTML body inside the layout shell */}
      <Section>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: caller-controlled, sanitised HTML from the AI-drafted patron email body */}
        <Text style={bodyWrapperStyle} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      </Section>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const bodyWrapperStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: 0,
};
