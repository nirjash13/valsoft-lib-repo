/**
 * Regression tests for REQ-07-07 (Markdown→HTML conversion) and
 * REQ-07-08 (5xx retry / 4xx no-retry).
 *
 * One test per distinct bug per the hard ceiling in .claude/rules/testing.md.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Gap 1 — REQ-07-07: markdownToHtml converts Markdown and strips <script>
// ---------------------------------------------------------------------------

describe("markdownToHtml", () => {
  it("converts **bold** to <strong> and strips an injected <script> tag", async () => {
    const { markdownToHtml } = await import("@/lib/notifications/markdown-to-html");

    const input = "Hello **world**\n\n<script>alert(1)</script>";
    const result = markdownToHtml(input);

    expect(result).toContain("<strong>world</strong>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert(1)");
  });
});

// ---------------------------------------------------------------------------
// Gap 2 — REQ-07-08: sendEmail retries 5xx and fails fast on 4xx
// ---------------------------------------------------------------------------

describe("sendEmail retry behaviour", () => {
  beforeEach(() => {
    // Set a real-looking API key so DEV-OUTBOX mode is bypassed.
    process.env.RESEND_API_KEY = "re_test_key";
    vi.resetModules();
  });

  it("retries a 5xx error and eventually succeeds on the third attempt", async () => {
    // Arrange: first two calls return 503; third succeeds.
    const mockSend = vi
      .fn()
      .mockResolvedValueOnce({
        error: { statusCode: 503, name: "ServiceUnavailable", message: "down" },
        data: null,
      })
      .mockResolvedValueOnce({
        error: { statusCode: 503, name: "ServiceUnavailable", message: "down" },
        data: null,
      })
      .mockResolvedValueOnce({ error: null, data: { id: "msg_ok" } });

    vi.doMock("resend", () => {
      // Must use `function` (not arrow) so `new Resend()` works.
      function MockResend() {
        return { emails: { send: mockSend } };
      }
      return { Resend: MockResend };
    });

    const { sendEmail, _retryDelaysMs } = await import("@/lib/notifications/email-client");
    // Zero the delays so the test runs instantly.
    _retryDelaysMs[0] = 0;
    _retryDelaysMs[1] = 0;

    const result = await sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" });

    expect(result.id).toBe("msg_ok");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 4xx error and throws immediately after the first attempt", async () => {
    // Arrange: 422 Unprocessable — permanent, must not retry.
    const mockSend = vi.fn().mockResolvedValue({
      error: { statusCode: 422, name: "ValidationError", message: "bad address" },
      data: null,
    });

    vi.doMock("resend", () => {
      function MockResend() {
        return { emails: { send: mockSend } };
      }
      return { Resend: MockResend };
    });

    const { sendEmail, _retryDelaysMs } = await import("@/lib/notifications/email-client");
    _retryDelaysMs[0] = 0;
    _retryDelaysMs[1] = 0;

    const { EmailSendError } = await import("@/lib/notifications/errors");

    await expect(
      sendEmail({ to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" }),
    ).rejects.toBeInstanceOf(EmailSendError);
    // Must not have retried.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
