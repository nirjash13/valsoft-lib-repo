import { _drainBuffer, _getBufferLength, recordSpan } from "@/lib/ai/tracing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const span = () =>
  recordSpan(
    { tenant_id: "t1", feature: "test", model: "m" },
    { start_ts: new Date(), end_ts: new Date() },
  );

describe("tracing ring buffer (REQ-11-10)", () => {
  beforeEach(() => {
    // With keys present, flushAsync takes the network path. Stub fetch with a
    // never-settling promise so the buffer is NOT drained during the test —
    // this exercises the genuine overflow path (Langfuse unreachable, backlog
    // full) rather than the dev-mode synchronous drain.
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-test");
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
  });

  afterEach(() => {
    _drainBuffer();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("caps the buffer at 1000 entries and counts overflow drops", async () => {
    const { langfuseSpansDropped: before } = await import("@/lib/ai/tracing");

    for (let i = 0; i < 1000; i++) {
      span();
    }
    expect(_getBufferLength()).toBe(1000);

    // The 1001st span must be dropped, not buffered.
    span();
    expect(_getBufferLength()).toBe(1000);

    const { langfuseSpansDropped: after } = await import("@/lib/ai/tracing");
    expect(after).toBeGreaterThan(before);
  });

  it("recordSpan never throws, even with malformed tags", () => {
    expect(() =>
      recordSpan(
        // biome-ignore lint/suspicious/noExplicitAny: intentional bad input for resilience test
        { tenant_id: "", feature: "", model: "" } as any,
        { start_ts: new Date(), end_ts: new Date(), error: "boom" },
      ),
    ).not.toThrow();
  });
});
