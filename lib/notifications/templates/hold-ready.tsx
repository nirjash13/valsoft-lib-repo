/**
 * Hold-ready notification email template.
 *
 * Sent when a hold is promoted and the book is available for pickup.
 * Transactional — no unsubscribeUrl (REQ/US-08).
 */

import { Heading, Text } from "@react-email/components";
import { Layout } from "./layout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HoldReadyProps {
  memberName: string;
  bookTitle: string;
  /** Formatted date string by which the member must collect the book. */
  pickupBy: string;
  libraryName: string;
}

// ---------------------------------------------------------------------------
// HoldReady
// ---------------------------------------------------------------------------

export function HoldReady({ memberName, bookTitle, pickupBy, libraryName }: HoldReadyProps) {
  return (
    <Layout
      libraryName={libraryName}
      preview={`"${bookTitle}" is ready for pickup — collect by ${pickupBy}`}
    >
      <Heading style={headingStyle}>Your hold is ready for pickup</Heading>
      <Text style={textStyle}>Hi {memberName},</Text>
      <Text style={textStyle}>
        Great news! <strong>"{bookTitle}"</strong> is now available and waiting for you at the
        library.
      </Text>
      <Text style={textStyle}>
        Please collect it by <strong>{pickupBy}</strong>, after which the hold will expire and the
        book may be made available to the next patron on the waitlist.
      </Text>
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
