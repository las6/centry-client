// src/stackParser.ts
var CHROME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
var FIREFOX_RE = /^(?:(.*?)@)?(.+?):(\d+)(?::(\d+))?\s*$/;
function parseChromeLine(line) {
  const m = CHROME_RE.exec(line);
  if (!m) return null;
  return {
    function: m[1] || "<anonymous>",
    filename: m[2],
    lineno: m[3] ? parseInt(m[3], 10) : null,
    colno: m[4] ? parseInt(m[4], 10) : null
  };
}
function parseFirefoxLine(line) {
  const m = FIREFOX_RE.exec(line);
  if (!m) return null;
  if (m[2] === "eval") return null;
  return {
    function: m[1] || "<anonymous>",
    filename: m[2],
    lineno: m[3] ? parseInt(m[3], 10) : null,
    colno: m[4] ? parseInt(m[4], 10) : null
  };
}
function parseStack(stack) {
  const lines = stack.split("\n");
  const frames = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("Error")) continue;
    const frame = parseChromeLine(line) || parseFirefoxLine(line);
    if (frame) frames.push(frame);
  }
  return frames.reverse();
}

// src/types.ts
var CENTRY_HOST = "https://centry.pages.dev";
function envelopeUrl(project) {
  return `${CENTRY_HOST}/api/${project}/envelope/`;
}

// src/_shared/envelope.ts
function buildEnvelope(event) {
  const eventJson = JSON.stringify(event);
  const header = JSON.stringify({ sent_at: (/* @__PURE__ */ new Date()).toISOString() });
  const itemHeader = JSON.stringify({ type: "event", length: eventJson.length });
  return `${header}
${itemHeader}
${eventJson}
`;
}

// src/_shared/toError.ts
function toError(value) {
  if (value instanceof Error) return value;
  if (value === null || value === void 0) return null;
  const msg = typeof value === "string" ? value : typeof value === "object" ? String(value.message || JSON.stringify(value)) : String(value);
  const err = new Error(msg);
  err.name = typeof value === "object" && value.name ? String(value.name) : "UnknownError";
  return err;
}

// src/_shared/rateLimiter.ts
var RateLimiter = class {
  constructor(max, windowMs) {
    this.timestamps = [];
    this.max = max;
    this.windowMs = windowMs;
  }
  allow() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.max) return false;
    this.timestamps.push(now);
    return true;
  }
};

// src/utils.ts
var sensitiveKeys = [
  "token",
  "api_key",
  "apikey",
  "auth",
  "password",
  "passwd",
  "secret",
  "session",
  "sid",
  "authorization",
  "credential",
  "sig",
  "signature",
  "key",
  "code",
  "pk",
  "sk",
  "jwt",
  "access_token",
  "refresh_token",
  "id_token"
];
function scrubUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const isSearch = urlStr.startsWith("?");
    const url = new URL(urlStr, "http://dummy.com");
    let hasSensitive = false;
    if (url.username) {
      url.username = "[filtered]";
      hasSensitive = true;
    }
    if (url.password) {
      url.password = "[filtered]";
      hasSensitive = true;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, "[filtered]");
        hasSensitive = true;
      }
    }
    const hash = url.hash;
    if (hash && (hash.includes("=") || hash.includes("&"))) {
      const hashContent = hash.startsWith("#") ? hash.slice(1) : hash;
      const hashParams = new URLSearchParams(hashContent);
      let hasFragmentSensitive = false;
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, "[filtered]");
          hasFragmentSensitive = true;
          hasSensitive = true;
        }
      }
      if (hasFragmentSensitive) {
        url.hash = "#" + hashParams.toString();
      }
    }
    if (!hasSensitive) return urlStr;
    let result = "";
    if (isSearch) {
      result = "?" + url.searchParams.toString();
    } else if (/^https?:\/\//i.test(urlStr)) {
      result = url.toString();
    } else if (urlStr.startsWith("/")) {
      const dummyPrefix = "http://dummy.com";
      result = url.toString();
      if (result.startsWith(dummyPrefix)) {
        result = result.substring(dummyPrefix.length);
      }
    } else {
      const dummyPrefix = "http://dummy.com/";
      result = url.toString();
      if (result.startsWith(dummyPrefix)) {
        result = result.substring(dummyPrefix.length);
      } else if (result.startsWith("http://dummy.com")) {
        result = result.substring("http://dummy.com".length);
      }
    }
    return result.replace(/%5Bfiltered%5D/gi, "[filtered]");
  } catch {
    return urlStr;
  }
}

// src/_shared/requestContext.ts
var SAFE_HEADERS = [
  "accept",
  "content-type",
  "user-agent",
  "referer",
  "cf-ray",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-vercel-id",
  "x-vercel-ip-country"
];
function buildRequestContext(req) {
  if (!req || typeof req !== "object") return null;
  if (typeof req.headers?.get === "function") {
    const request = req;
    const headers = {};
    for (const key of SAFE_HEADERS) {
      let val = request.headers.get(key);
      if (key === "referer" && val) val = scrubUrl(val);
      if (val) headers[key] = val;
    }
    return { method: request.method, url: scrubUrl(request.url), headers };
  }
  const r = req;
  if (r.headers && typeof r.headers === "object") {
    const headers = {};
    for (const key of SAFE_HEADERS) {
      let val = r.headers[key];
      if (key === "referer" && typeof val === "string") val = scrubUrl(val);
      if (typeof val === "string") headers[key] = val;
    }
    return {
      method: r.method,
      url: r.url ? scrubUrl(r.url) : void 0,
      headers
    };
  }
  return null;
}

// src/_shared/baseServerClient.ts
var BaseServerClient = class {
  constructor(config) {
    this.recentErrors = /* @__PURE__ */ new Set();
    this._pending = /* @__PURE__ */ new Set();
    this.config = config;
    this.url = envelopeUrl(config.project);
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 6e4);
  }
  // ── Public API ──────────────────────────────────────────────────────────────
  /** Capture a manually-caught exception (handled = true). */
  captureException(error, request) {
    void this._capture(error, true, request ?? this.getStore());
  }
  /** Capture an unhandled exception (handled = false). Used by global handlers + withCentry. */
  captureUnhandled(error, request) {
    void this._capture(error, false, request ?? this.getStore());
  }
  /**
   * Capture a plain message (non-exception). Level defaults to 'info'.
   * Useful for logging significant events (deployments, job completions, etc.).
   */
  captureMessage(message, level = "info") {
    void this._captureMessage(message, level);
  }
  /**
   * Await all in-flight sends, with a timeout. Call this before a serverless
   * function returns (Lambda, Vercel) or pass to ctx.waitUntil() in CF Workers.
   */
  async flush(timeoutMs = 2e3) {
    await Promise.race([
      Promise.allSettled(this._pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }
  // ── Internal ────────────────────────────────────────────────────────────────
  async _capture(error, handled, request) {
    try {
      if (this.config.enabled === false) return;
      const err = toError(error);
      if (!err) return;
      const dedupKey = `${err.name}:${err.message}:${err.stack?.slice(0, 150) ?? ""}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
      const frames = err.stack ? parseStack(err.stack) : [];
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        environment: this.config.environment,
        release: this.config.release,
        exception: {
          values: [
            {
              type: err.name || "Error",
              value: err.message,
              mechanism: { type: handled ? "generic" : "onerror", handled },
              stacktrace: { frames }
            }
          ]
        },
        contexts: {
          runtime: this.runtimeContext
        }
      };
      const reqCtx = buildRequestContext(request);
      if (reqCtx) event["request"] = reqCtx;
      this._send(event);
    } catch {
    }
  }
  async _captureMessage(message, level) {
    try {
      if (this.config.enabled === false) return;
      if (!message) return;
      const dedupKey = `message:${level}:${message.slice(0, 150)}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level,
        environment: this.config.environment,
        release: this.config.release,
        message,
        contexts: {
          runtime: this.runtimeContext
        }
      };
      const reqCtx = buildRequestContext(this.getStore());
      if (reqCtx) event["request"] = reqCtx;
      this._send(event);
    } catch {
    }
  }
  _send(event) {
    try {
      const envelope = buildEnvelope(event);
      const p = fetch(this.url, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "text/plain" }
      }).then(() => {
      }).catch(() => {
      }).finally(() => this._pending.delete(p));
      this._pending.add(p);
    } catch {
    }
  }
};

// src/worker.ts
var _als = void 0;
function getAls() {
  if (_als !== void 0) return _als;
  try {
    const ALS = globalThis["AsyncLocalStorage"];
    _als = ALS ? new ALS() : null;
  } catch {
    _als = null;
  }
  return _als;
}
var WorkerClient = class extends BaseServerClient {
  constructor(config) {
    super(config);
  }
  getStore() {
    return getAls()?.getStore();
  }
  get runtimeContext() {
    return { name: "cloudflare-worker" };
  }
  /**
   * Capture a caught exception. Optionally pass the Request explicitly —
   * if omitted and withCentry() is in use, the request is picked up
   * automatically from AsyncLocalStorage context.
   */
  captureException(error, request) {
    super.captureException(error, request);
  }
  /** For use in unhandled rejection / uncaughtException hooks. */
  captureUnhandled(error, request) {
    super.captureUnhandled(error, request);
  }
};
var _workerClient = null;
function initWorker(config) {
  _workerClient = new WorkerClient(config);
  return _workerClient;
}
function captureWorkerException(error, request) {
  _workerClient?.captureException(error, request);
}
function captureWorkerMessage(message, level = "info") {
  _workerClient?.captureMessage(message, level);
}
function getWorkerClient() {
  return _workerClient;
}
function withCentry(config, handler) {
  const client = initWorker(config);
  const als = getAls();
  const wrapped = {};
  if (handler.fetch) {
    const originalFetch = handler.fetch;
    wrapped.fetch = async (request, env, ctx) => {
      const run = () => Promise.resolve(
        originalFetch(request, env, ctx)
      ).catch((err) => {
        client.captureUnhandled(err, request);
        throw err;
      });
      const responsePromise = als ? als.run(request, run) : run();
      ctx.waitUntil(responsePromise.then(() => client.flush(), () => client.flush()));
      return responsePromise;
    };
  }
  if (handler.scheduled) {
    const originalScheduled = handler.scheduled;
    wrapped.scheduled = async (event, env, ctx) => {
      try {
        await originalScheduled(event, env, ctx);
      } catch (err) {
        client.captureUnhandled(err);
        throw err;
      } finally {
        ctx.waitUntil(client.flush());
      }
    };
  }
  return wrapped;
}
export {
  WorkerClient,
  captureWorkerException,
  captureWorkerMessage,
  getWorkerClient,
  initWorker,
  withCentry
};
