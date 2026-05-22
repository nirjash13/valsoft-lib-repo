/**
 * Membership rejection email template.
 *
 * Sent when a member application is rejected. Transactional — no unsubscribeUrl
 * (REQ/US-08).
 */

import { Heading, Text } from "@react-email/components";
import { Layout } from "./layout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RejectionProps {
  memberName: string;
  libraryName: string;
  /** Human-readable reason for the rejection, provided by the librarian. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

export function Rejection({ memberName, libraryName, reason }: RejectionProps) {
  return (
    <Layout
      libraryName={libraryName}
      preview={`Update on your ${libraryName} membership application`}
    >
      <Heading style={headingStyle}>Membership application update</Heading>
      <Text style={textStyle}>Hi {memberName},</Text>
      <Text style={textStyle}>
        Thank you for applying to join {libraryName}. After review, we are unable to approve your
        membership application at this time.
      </Text>
      <Text style={textStyle}>
        <strong>Reason:</strong> {reason}
      </Text>
      <Text style={textStyle}>
        If you believe this is an error, please contact the library directly.
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
