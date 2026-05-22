/**
 * Shared email layout shell.
 *
 * Renders a brand header with the library name, a body slot, and a footer.
 * When `unsubscribeUrl` is provided (lifecycle emails), an unsubscribe link
 * appears in the footer. Transactional emails (hold-ready, welcome, rejection)
 * omit it per REQ/US-08.
 */

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LayoutProps {
  libraryName: string;
  /** Short preview text shown in email client inboxes. */
  preview: string;
  children: ReactNode;
  /** When present, renders an unsubscribe link in the footer (lifecycle emails). */
  unsubscribeUrl?: string;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Layout({ libraryName, preview, children, unsubscribeUrl }: LayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {/* Header */}
          <Section style={headerStyle}>
            <Text style={headerTextStyle}>{libraryName}</Text>
          </Section>

          <Hr style={dividerStyle} />

          {/* Body slot */}
          <Section style={contentStyle}>{children}</Section>

          <Hr style={dividerStyle} />

          {/* Footer */}
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              {libraryName} — this email was sent to you because you are a registered member.
            </Text>
            {unsubscribeUrl !== undefined && (
              <Text style={footerTextStyle}>
                <Link href={unsubscribeUrl} style={unsubscribeLinkStyle}>
                  Unsubscribe from reminder emails
                </Link>
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Styles (inline — required by email clients)
// ---------------------------------------------------------------------------

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f4f4f5",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  margin: 0,
  padding: "40px 0",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  maxWidth: "600px",
  margin: "0 auto",
  padding: "0",
};

const headerStyle: React.CSSProperties = {
  padding: "24px 32px 16px",
};

const headerTextStyle: React.CSSProperties = {
  color: "#18181b",
  fontSize: "20px",
  fontWeight: "700",
  margin: 0,
};

const dividerStyle: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "0",
};

const contentStyle: React.CSSProperties = {
  padding: "24px 32px",
};

const footerStyle: React.CSSProperties = {
  padding: "16px 32px 24px",
};

const footerTextStyle: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "0 0 4px",
};

const unsubscribeLinkStyle: React.CSSProperties = {
  color: "#71717a",
  textDecoration: "underline",
};
