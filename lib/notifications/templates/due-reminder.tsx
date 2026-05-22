/**
 * Due-date reminder email template.
 *
 * Adapts copy for three reminder ticks:
 *   - "T-2" → due in 2 days
 *   - "T-0" → due today
 *   - "T+1" → overdue (1+ days past due)
 *
 * Always includes an `unsubscribeUrl` per lifecycle email convention (REQ/US-08).
 */

import { Heading, Text } from "@react-email/components";
import { Layout } from "./layout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DueReminderProps {
  tick: "T-2" | "T-0" | "T+1";
  memberName: string;
  bookTitle: string;
  /** Formatted date string, e.g. "June 3, 2026" */
  dueDate: string;
  libraryName: string;
  unsubscribeUrl: string;
}

// ---------------------------------------------------------------------------
// Copy per tick
// ---------------------------------------------------------------------------

interface TickCopy {
  preview: string;
  heading: string;
  body: string;
}

function getTickCopy(tick: DueReminderProps["tick"], bookTitle: string, dueDate: string): TickCopy {
  switch (tick) {
    case "T-2":
      return {
        preview: `Reminder: "${bookTitle}" is due in 2 days`,
        heading: "Your book is due in 2 days",
        body: `"${bookTitle}" is due back at the library on ${dueDate}. Please return or renew it before then to avoid late fees.`,
      };
    case "T-0":
      return {
        preview: `Today is the last day: "${bookTitle}" is due`,
        heading: "Your book is due today",
        body: `"${bookTitle}" is due back at the library today, ${dueDate}. Please return or renew it to avoid late fees.`,
      };
    case "T+1":
      return {
        preview: `Overdue: "${bookTitle}" was due ${dueDate}`,
        heading: "Your book is overdue",
        body: `"${bookTitle}" was due on ${dueDate} and is now overdue. Please return it as soon as possible to avoid additional late fees.`,
      };
  }
}

// ---------------------------------------------------------------------------
// DueReminder
// ---------------------------------------------------------------------------

export function DueReminder({
  tick,
  memberName,
  bookTitle,
  dueDate,
  libraryName,
  unsubscribeUrl,
}: DueReminderProps) {
  const copy = getTickCopy(tick, bookTitle, dueDate);

  return (
    <Layout libraryName={libraryName} preview={copy.preview} unsubscribeUrl={unsubscribeUrl}>
      <Heading style={headingStyle}>{copy.heading}</Heading>
      <Text style={textStyle}>Hi {memberName},</Text>
      <Text style={textStyle}>{copy.body}</Text>
      <Text style={textStyle}>Thank you,</Text>
      <Text style={textStyle}>{libraryName}</Text>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  color: "#18181b",
  fontSize: "22px",
  fontWeight: "700",
  margin: "0 0 16px",
};

const textStyle: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "15px",
  lineHeight: "1.6",
  margin: "0 0 12px",
};
