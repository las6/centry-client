import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorkerClient,
  initWorker,
  captureWorkerException,
  getWorkerClient,
  withCentry,
} from "./worker";

function fetchCalls(): { url: string; body: string }[] {
  return vi.mocked(fetch).mock.calls.map(([input, init]) => ({
    url: input instanceof Request ? input.url : String(input),
    body: String((init as RequestInit).body || ""),
  }));
}

describe("WorkerClient", () => {
  let client: WorkerClient;

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
    client = new WorkerClient({ project: "test-project" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("event capture", () => {
    it("sends event to the correct envelope URL", async () => {
      client.captureException(new Error("worker error"));
      await vi.runAllTimersAsync();

      const calls = fetchCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/api/test-project/envelope/");
    });

    it("builds a valid envelope", async () => {
      client.captureException(new Error("worker boom"));
      await vi.runAllTimersAsync();

      const body = fetchCalls()[0].body;
      const lines = body.split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);

      const header = JSON.parse(lines[0]);
      const itemHeader = JSON.parse(lines[1]);
      const event = JSON.parse(lines[2]);

      expect(header.sent_at).toBe("2025-01-15T12:00:00.000Z");
      expect(itemHeader.type).toBe("event");
      expect(event.exception.values[0].value).toBe("worker boom");
    });

    it("includes event metadata", async () => {
      client.captureException(new Error("meta test"));
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.event_id).toBe("11111111222243338444555555555555");
      expect(event.timestamp).toBe("2025-01-15T12:00:00.000Z");
      expect(event.level).toBe("error");
      expect(event.exception.values[0].type).toBe("Error");
      expect(event.exception.values[0].mechanism).toEqual({
        type: "generic",
        handled: true,
      });
    });

    it("marks unhandled errors", async () => {
      client.captureUnhandled(new Error("unhandled"));
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.exception.values[0].mechanism).toEqual({
        type: "onerror",
        handled: false,
      });
    });

    it("includes environment and release", async () => {
      const configured = new WorkerClient({
        project: "p",
        environment: "prod",
        release: "2.0.0",
      });
      configured.captureException(new Error("x"));
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.environment).toBe("prod");
      expect(event.release).toBe("2.0.0");
    });

    it("sets runtime context to cloudflare-worker", async () => {
      client.captureException(new Error("x"));
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.contexts.runtime).toEqual({ name: "cloudflare-worker" });
    });
  });

  describe("request context", () => {
    it("attaches request context when Request is passed", async () => {
      const req = new Request("https://api.example.com/users", {
        method: "GET",
        headers: new Headers({
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "TestAgent/1.0",
          referer: "https://dashboard.example.com",
          "cf-ray": "abc123",
          "cf-connecting-ip": "1.2.3.4",
          authorization: "Bearer secret", // not in SAFE_HEADERS
        }),
      });

      client.captureException(new Error("api error"), req);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.request).toEqual({
        method: "GET",
        url: "https://api.example.com/users",
        headers: expect.objectContaining({
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "TestAgent/1.0",
          "cf-ray": "abc123",
          "cf-connecting-ip": "1.2.3.4",
        }),
      });
    });

    it("filters out sensitive headers", async () => {
      const req = new Request("https://api.example.com", {
        headers: new Headers({
          authorization: "Bearer token123",
          cookie: "session=abc",
          "x-api-key": "secret",
          "user-agent": "Test/1.0",
        }),
      });

      client.captureException(new Error("x"), req);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      const headers = (event.request as Record<string, unknown>)
        .headers as Record<string, string>;
      expect(headers["user-agent"]).toBe("Test/1.0");
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["cookie"]).toBeUndefined();
    });

    it("scrubs sensitive query parameters from the URL", async () => {
      const req = new Request(
        "https://api.example.com/v1/user?token=secret&api_key=123",
      );
      client.captureException(new Error("test"), req);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.request.url).toBe(
        "https://api.example.com/v1/user?token=[filtered]&api_key=[filtered]",
      );
    });

    it("keeps referer but scrubs sensitive query parameters from it", async () => {
      const req = {
        method: "GET",
        url: "/v1/user",
        headers: {
          referer:
            "https://dashboard.example.com/reset?token=secret&tab=security",
        },
      };
      client.captureException(new Error("test"), req);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      const headers = (event.request as Record<string, unknown>)
        .headers as Record<string, string>;
      expect(headers["referer"]).toBe(
        "https://dashboard.example.com/reset?token=[filtered]&tab=security",
      );
    });
  });

  describe("dedup", () => {
    it("suppresses duplicate errors", () => {
      const err = new Error("dupe");
      client.captureException(err);
      client.captureException(err);
      client.captureException(err);
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(1);
    });

    it("allows different errors", () => {
      client.captureException(new Error("one"));
      client.captureException(new Error("two"));
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(2);
    });
  });

  describe("rate limiting", () => {
    it("caps at maxEventsPerMinute", () => {
      const limited = new WorkerClient({ project: "p", maxEventsPerMinute: 3 });
      for (let i = 0; i < 10; i++) {
        limited.captureException(new Error(`err ${i}`));
      }
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(3);
    });
  });

  describe("disabled state", () => {
    it("sends nothing when enabled is false", () => {
      const disabled = new WorkerClient({ project: "p", enabled: false });
      disabled.captureException(new Error("x"));
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(0);
    });
  });

  describe("toError conversion", () => {
    it("converts string to Error", async () => {
      client.captureException("string error" as unknown as Error);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.exception.values[0].value).toBe("string error");
      expect(event.exception.values[0].type).toBe("UnknownError");
    });

    it("handles object with message property", async () => {
      client.captureException({
        message: "obj error",
        name: "CustomError",
      } as unknown as Error);
      await vi.runAllTimersAsync();

      const event = JSON.parse(fetchCalls()[0].body.split("\n")[2]);
      expect(event.exception.values[0].value).toBe("obj error");
      expect(event.exception.values[0].type).toBe("CustomError");
    });

    it("handles null and undefined", () => {
      client.captureException(null as unknown as Error);
      client.captureException(undefined as unknown as Error);
      vi.runAllTimers();
      expect(fetchCalls()).toHaveLength(0);
    });
  });
});

describe("module-level singleton", () => {
  beforeEach(async () => {
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

  it("getWorkerClient returns null before init", () => {
    expect(getWorkerClient()).toBeNull();
  });

  it("captureWorkerException is no-op before init", () => {
    captureWorkerException(new Error("x"));
    vi.runAllTimers();
    expect(fetchCalls()).toHaveLength(0);
  });

  it("initWorker sets the client", () => {
    initWorker({ project: "my-app" });
    expect(getWorkerClient()).toBeInstanceOf(WorkerClient);
  });

  it("captureWorkerException sends after init", () => {
    initWorker({ project: "my-app" });
    captureWorkerException(new Error("test"));
    vi.runAllTimers();
    expect(fetchCalls()).toHaveLength(1);
  });
});

describe("withCentry", () => {
  let waitUntilSpy: ReturnType<typeof vi.fn>;
  let mockCtx: ExecutionContext;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    vi.stubGlobal("crypto", { randomUUID: () => "xxx" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    waitUntilSpy = vi.fn();
    mockCtx = {
      waitUntil: waitUntilSpy,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("wraps fetch handler", async () => {
    const handler = {
      fetch: async () => new Response("OK"),
    };

    const wrapped = withCentry({ project: "my-app" }, handler);
    expect(wrapped).toHaveProperty("fetch");
    expect(wrapped.fetch).toBeInstanceOf(Function);

    const req = new Request("https://example.com/test");
    const response = await wrapped.fetch!(req, {}, mockCtx);
    expect(response.status).toBe(200);
  });

  it("calls ctx.waitUntil(client.flush()) on successful fetch", async () => {
    const wrapped = withCentry(
      { project: "my-app" },
      {
        fetch: async () => new Response("OK"),
      },
    );

    const req = new Request("https://example.com/test");
    await wrapped.fetch!(req, {}, mockCtx);

    expect(waitUntilSpy).toHaveBeenCalledOnce();
    // The argument must be a Promise (the flush promise)
    expect(waitUntilSpy.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("calls ctx.waitUntil(client.flush()) even when fetch handler throws", async () => {
    const wrapped = withCentry(
      { project: "my-app" },
      {
        fetch: async () => {
          throw new Error("handler error");
        },
      },
    );

    const req = new Request("https://example.com/test");
    await expect(wrapped.fetch!(req, {}, mockCtx)).rejects.toThrow(
      "handler error",
    );

    expect(waitUntilSpy).toHaveBeenCalledOnce();
    expect(waitUntilSpy.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("captures errors from fetch handler", async () => {
    const handler = {
      fetch: async () => {
        throw new Error("handler error");
      },
    };

    const wrapped = withCentry({ project: "my-app" }, handler);
    const req = new Request("https://example.com/test");

    await expect(wrapped.fetch!(req, {}, mockCtx)).rejects.toThrow(
      "handler error",
    );

    vi.runAllTimers();
    const calls = fetchCalls();
    const errorCalls = calls.filter((c) =>
      c.url.includes("/api/my-app/envelope/"),
    );
    expect(errorCalls.length).toBe(1);
  });

  it("wraps scheduled handler", () => {
    const handler = {
      scheduled: async () => {},
    };
    const wrapped = withCentry({ project: "my-app" }, handler);
    expect(wrapped).toHaveProperty("scheduled");
    expect(wrapped.scheduled).toBeInstanceOf(Function);
  });

  it("calls ctx.waitUntil(client.flush()) after scheduled handler", async () => {
    const wrapped = withCentry(
      { project: "my-app" },
      {
        scheduled: async () => {},
      },
    );

    await wrapped.scheduled!({} as ScheduledController, {}, mockCtx);

    expect(waitUntilSpy).toHaveBeenCalledOnce();
    expect(waitUntilSpy.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("calls ctx.waitUntil(client.flush()) even when scheduled handler throws", async () => {
    const wrapped = withCentry(
      { project: "my-app" },
      {
        scheduled: async () => {
          throw new Error("cron failure");
        },
      },
    );

    await expect(
      wrapped.scheduled!({} as ScheduledController, {}, mockCtx),
    ).rejects.toThrow("cron failure");

    expect(waitUntilSpy).toHaveBeenCalledOnce();
  });
});
