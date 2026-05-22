/**
 * Welcome email template.
 *
 * Sent when a member application is approved. Transactional — no unsubscribeUrl
 * (REQ/US-08). Optional `libraryAddress` and `cardNumber` fields appear when
 * provided.
 */

import { Heading, Text } from "@react-email/components";
import { Layout } from "./layout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WelcomeProps {
  memberName: string;
  libraryName: string;
  catalogUrl: string;
  libraryAddress?: string;
  cardNumber?: string;
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

export function Welcome({
  memberName,
  libraryName,
  catalogUrl,
  libraryAddress,
  cardNumber,
}: WelcomeProps) {
  return (
    <Layout
      libraryName={libraryName}
      preview={`Welcome to ${libraryName} — your membership is approved`}
    >
      <Heading style={headingStyle}>Welcome to {libraryName}!</Heading>
      <Text style={textStyle}>Hi {memberName},</Text>
      <Text style={textStyle}>
        Your membership application has been approved. We're delighted to have you as a member.
      </Text>
      {cardNumber !== undefined && (
        <Text style={textStyle}>
          Your library card number is: <strong>{cardNumber}</strong>
        </Text>
      )}
      <Text style={textStyle}>
        Browse our catalog at:{" "}
        <a href={catalogUrl} style={linkStyle}>
          {catalogUrl}
        </a>
      </Text>
      {libraryAddress !== undefined && <Text style={textStyle}>Visit us at: {libraryAddress}</Text>}
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

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  textDecoration: "underline",
};
