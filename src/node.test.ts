import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NodeClient,
  initNode,
  captureException,
  captureMessage,
  getNodeClient,
  withCentry,
  installNodeGlobalHandlers,
} from "./node";

function fetchCalls(): { url: string; body: string }[] {
  return vi.mocked(fetch).mock.calls.map(([input, init]) => ({
    url: input instanceof Request ? input.url : String(input),
    body: String((init as RequestInit).body || ""),
  }));
}

function parsedEvent(body: string): Record<string, unknown> {
  return JSON.parse(body.split("\n")[2]);
}

// Reset singleton between tests by re-importing via initNode

describe("NodeClient", () => {
  let client: NodeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-2222-4333-8444-555555555555",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"id":"issue1"}', { status: 200 })),
    );
    client = new NodeClient({ project: "test-project" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("event capture", () => {
    it("sends event to the correct envelope URL", async () => {
      client.captureException(new Error("node error"));
      await vi.runAllTimersAsync();

      const calls = fetchCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/api/test-project/envelope/");
    });

    it("builds a valid 3-line envelope", async () => {
      client.captureException(new Error("node boom"));
      await vi.runAllTimersAsync();

      const body = fetchCalls()[0].body;
      const lines = body.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);

      const header = JSON.parse(lines[0]);
      const itemHeader = JSON.parse(lines[1]);
      const event = JSON.parse(lines[2]);

      expect(header.sent_at).toBe("2025-01-15T12:00:00.000Z");
      expect(itemHeader.type).toBe("event");
      expect(event.exception.values[0].value).toBe("node boom");
    });

    it("includes event metadata", async () => {
      client.captureException(new Error("meta test"));
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(event.event_id).toBe("11111111222243338444555555555555");
      expect(event.timestamp).toBe("2025-01-15T12:00:00.000Z");
      expect(event.level).toBe("error");
      expect(
        (event.exception as Record<string, unknown[]>).values[0],
      ).toMatchObject({
        type: "Error",
        mechanism: { type: "generic", handled: true },
      });
    });

    it("marks unhandled errors correctly", async () => {
      client.captureUnhandled(new Error("unhandled"));
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(
        (event.exception as Record<string, unknown[]>).values[0],
      ).toMatchObject({
        mechanism: { type: "onerror", handled: false },
      });
    });

    it("includes environment and release", async () => {
      const configured = new NodeClient({
        project: "p",
        environment: "prod",
        release: "1.0.0",
      });
      configured.captureException(new Error("x"));
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(event.environment).toBe("prod");
      expect(event.release).toBe("1.0.0");
    });

    it("sets runtime context to node with version", async () => {
      client.captureException(new Error("x"));
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      const runtime = (event.contexts as Record<string, unknown>)
        .runtime as Record<string, string>;
      expect(runtime.name).toBe("node");
      expect(runtime.version).toMatch(/^v\d+/);
    });
  });

  describe("captureMessage", () => {
    it("sends a message event with correct shape", async () => {
      client.captureMessage("Deployment complete");
      await vi.runAllTimersAsync();

      const body = fetchCalls()[0].body;
      const lines = body.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);

      const event = JSON.parse(lines[2]);
      expect(event.message).toBe("Deployment complete");
      expect(event.level).toBe("info");
      expect(event.exception).toBeUndefined();
    });

    it("respects the level parameter", async () => {
      client.captureMessage("Something degraded", "warning");
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(event.level).toBe("warning");
    });

    it("deduplicates identical messages", async () => {
      client.captureMessage("same message");
      client.captureMessage("same message");
      client.captureMessage("same message");
      await vi.runAllTimersAsync();
      expect(fetchCalls()).toHaveLength(1);
    });
  });

  describe("request context", () => {
    it("attaches Web Request context when passed explicitly", async () => {
      const req = new Request("https://api.example.com/users", {
        method: "POST",
        headers: new Headers({
          "user-agent": "TestAgent/1.0",
          "content-type": "application/json",
          authorization: "Bearer secret",
        }),
      });

      client.captureException(new Error("api error"), req);
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      const reqCtx = event.request as Record<string, unknown>;
      expect(reqCtx.method).toBe("POST");
      expect(reqCtx.url).toBe("https://api.example.com/users");
      const headers = reqCtx.headers as Record<string, string>;
      expect(headers["user-agent"]).toBe("TestAgent/1.0");
      expect(headers["authorization"]).toBeUndefined();
    });

    it("attaches IncomingMessage-style context when passed explicitly", async () => {
      const req = {
        method: "GET",
        url: "/api/notes?token=secret",
        headers: {
          "user-agent": "node-fetch/1.0",
          "x-forwarded-for": "1.2.3.4",
          authorization: "Bearer token",
        },
      };

      client.captureException(new Error("node handler error"), req);
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      const reqCtx = event.request as Record<string, unknown>;
      expect(reqCtx.method).toBe("GET");
      expect(reqCtx.url).toBe("/api/notes?token=[filtered]");
      const headers = reqCtx.headers as Record<string, string>;
      expect(headers["user-agent"]).toBe("node-fetch/1.0");
      expect(headers["x-forwarded-for"]).toBe("1.2.3.4");
      expect(headers["authorization"]).toBeUndefined();
    });

    it("does not attach request context when not provided", async () => {
      client.captureException(new Error("no request"));
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(event.request).toBeUndefined();
    });
  });

  describe("dedup", () => {
    it("suppresses identical errors within the dedup window", () => {
      const err = new Error("dupe");
      client.captureException(err);
      client.captureException(err);
      client.captureException(err);
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(1);
    });

    it("allows different errors through", () => {
      client.captureException(new Error("one"));
      client.captureException(new Error("two"));
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(2);
    });

    it("re-sends the same error after the dedup window expires", () => {
      const err = new Error("dupe");
      client.captureException(err);
      vi.advanceTimersByTime(10_001);
      client.captureException(err);
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(2);
    });
  });

  describe("rate limiting", () => {
    it("caps at maxEventsPerMinute", () => {
      const limited = new NodeClient({ project: "p", maxEventsPerMinute: 3 });
      for (let i = 0; i < 10; i++) {
        limited.captureException(new Error(`err ${i}`));
      }
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(3);
    });
  });

  describe("disabled state", () => {
    it("sends nothing when enabled is false", () => {
      const disabled = new NodeClient({ project: "p", enabled: false });
      disabled.captureException(new Error("x"));
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(0);
    });
  });

  describe("flush", () => {
    it("resolves when all pending sends complete", async () => {
      client.captureException(new Error("flush test"));
      await client.flush();
      // If flush works, fetch will have been called exactly once
      expect(fetchCalls()).toHaveLength(1);
    });

    it("resolves after timeout even if sends are slow", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockImplementation(
            () => new Promise((resolve) => setTimeout(resolve, 5000)),
          ),
      );
      const slowClient = new NodeClient({ project: "p" });
      slowClient.captureException(new Error("slow"));
      const _start = Date.now();
      const flushPromise = slowClient.flush(100);
      vi.advanceTimersByTime(200);
      await flushPromise;
      // Should have resolved (via timeout), not hung
      expect(true).toBe(true);
    });
  });

  describe("toError conversion", () => {
    it("converts string to Error", async () => {
      client.captureException("string error" as unknown as Error);
      await vi.runAllTimersAsync();

      const event = parsedEvent(fetchCalls()[0].body);
      expect(
        (event.exception as Record<string, unknown[]>).values[0],
      ).toMatchObject({
        value: "string error",
        type: "UnknownError",
      });
    });

    it("handles null and undefined silently", () => {
      client.captureException(null as unknown as Error);
      client.captureException(undefined as unknown as Error);
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(0);
    });
  });
});

describe("module-level singleton (initNode / captureException)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "xxx" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("getNodeClient returns a client after initNode", () => {
    initNode({ project: "my-app" });
    expect(getNodeClient()).toBeInstanceOf(NodeClient);
  });

  it("captureException sends after initNode", () => {
    initNode({ project: "my-app" });
    captureException(new Error("test"));
    vi.runAllTimers();
    expect(fetchCalls()).toHaveLength(1);
  });

  it("captureMessage sends after initNode", async () => {
    initNode({ project: "my-app" });
    captureMessage("hello", "info");
    await vi.runAllTimersAsync();
    const event = parsedEvent(fetchCalls()[0].body);
    expect(event.message).toBe("hello");
  });
});

describe("installNodeGlobalHandlers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "xxx" });
    vi.useFakeTimers();
    // Reset the module-level singleton so stale handlers from prior describe
    // blocks don't interfere. enabled:false means the replacement client won't
    // send events even if its handlers fire.
    initNode({ project: "_reset", enabled: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("captures uncaughtException events", async () => {
    const client = new NodeClient({ project: "p" });
    const cleanup = installNodeGlobalHandlers(client);

    process.emit(
      "uncaughtException",
      new Error("global crash") as Error & { domainEmitter?: unknown },
    );
    await vi.runAllTimersAsync();

    const calls = fetchCalls();
    expect(calls.length).toBeGreaterThan(0);
    const event = parsedEvent(calls[0].body);
    expect(
      (event.exception as Record<string, unknown[]>).values[0],
    ).toMatchObject({
      value: "global crash",
    });

    cleanup();
  });

  it("captures unhandledRejection events", async () => {
    const client = new NodeClient({ project: "p" });
    const cleanup = installNodeGlobalHandlers(client);

    process.emit(
      "unhandledRejection",
      new Error("promise rejected"),
      Promise.resolve(),
    );
    await vi.runAllTimersAsync();

    const calls = fetchCalls();
    expect(calls.length).toBeGreaterThan(0);
    const event = parsedEvent(calls[0].body);
    expect(
      (event.exception as Record<string, unknown[]>).values[0],
    ).toMatchObject({
      value: "promise rejected",
    });

    cleanup();
  });

  it("cleanup removes the handlers", () => {
    const client = new NodeClient({ project: "p" });
    const cleanup = installNodeGlobalHandlers(client);
    cleanup();

    process.emit(
      "uncaughtException",
      new Error("after cleanup") as Error & { domainEmitter?: unknown },
    );
    vi.runAllTimers();
    expect(fetchCalls()).toHaveLength(0);
  });
});

describe("withCentry (Node)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "xxx" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns the handler result", async () => {
    const wrapped = withCentry({ project: "p" }, async () => "hello");
    const result = await wrapped();
    expect(result).toBe("hello");
  });

  it("captures unhandled errors from the handler", async () => {
    const wrapped = withCentry({ project: "p" }, async () => {
      throw new Error("handler exploded");
    });

    await expect(wrapped()).rejects.toThrow("handler exploded");
    await vi.runAllTimersAsync();

    const calls = fetchCalls().filter((c) =>
      c.url.includes("/api/p/envelope/"),
    );
    expect(calls.length).toBeGreaterThan(0);
    const event = parsedEvent(calls[0].body);
    expect(
      (event.exception as Record<string, unknown[]>).values[0],
    ).toMatchObject({
      value: "handler exploded",
      mechanism: { handled: false },
    });
  });

  it("attaches Web Request context via ALS", async () => {
    const req = new Request("https://api.example.com/data", { method: "GET" });

    const wrapped = withCentry({ project: "p" }, async (_request: Request) => {
      // captureException inside handler — should pick up request from ALS
      getNodeClient()?.captureException(new Error("inside handler"));
      return new Response("ok");
    });

    await wrapped(req);
    await vi.runAllTimersAsync();

    const calls = fetchCalls().filter((c) =>
      c.url.includes("/api/p/envelope/"),
    );
    const errorCall = calls.find((c) => {
      const event = parsedEvent(c.body);
      return (
        (event.exception as Record<string, unknown[]> | undefined) !== undefined
      );
    });
    expect(errorCall).toBeDefined();
    const event = parsedEvent(errorCall!.body);
    expect((event.request as Record<string, unknown>)?.url).toBe(
      "https://api.example.com/data",
    );
  });

  it("attaches IncomingMessage-style context via ALS", async () => {
    const req = {
      method: "POST",
      url: "/api/notes",
      headers: { "user-agent": "vercel-node/1.0" },
    };
    const res = { end: vi.fn() };

    const wrapped = withCentry(
      { project: "p" },
      async (_request: unknown, _response: unknown) => {
        getNodeClient()?.captureException(new Error("node handler error"));
      },
    );

    await wrapped(req, res);
    await vi.runAllTimersAsync();

    const calls = fetchCalls().filter((c) =>
      c.url.includes("/api/p/envelope/"),
    );
    const errorCall = calls.find((c) => {
      const event = parsedEvent(c.body);
      return (
        (event.exception as Record<string, unknown[]> | undefined) !== undefined
      );
    });
    expect(errorCall).toBeDefined();
    const event = parsedEvent(errorCall!.body);
    expect((event.request as Record<string, unknown>)?.method).toBe("POST");
  });

  it("calls flush after the handler returns", async () => {
    const flushSpy = vi.spyOn(NodeClient.prototype, "flush");

    const wrapped = withCentry({ project: "p" }, async () => "done");
    await wrapped();

    expect(flushSpy).toHaveBeenCalledOnce();
  });

  it("calls flush even when the handler throws", async () => {
    const flushSpy = vi.spyOn(NodeClient.prototype, "flush");

    const wrapped = withCentry({ project: "p" }, async () => {
      throw new Error("boom");
    });

    await expect(wrapped()).rejects.toThrow();
    expect(flushSpy).toHaveBeenCalledOnce();
  });
});
