"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CentryClient: () => CentryClient,
  CentryProvider: () => CentryProvider,
  WorkerClient: () => WorkerClient,
  captureException: () => captureException,
  captureWorkerException: () => captureWorkerException,
  getClient: () => getClient,
  getWorkerClient: () => getWorkerClient,
  init: () => init,
  initWorker: () => initWorker,
  installGlobalHandlers: () => installGlobalHandlers,
  withCentry: () => withCentry
});
module.exports = __toCommonJS(index_exports);

// src/CentryProvider.tsx
var import_react = require("react");

// src/stackParser.ts
var CHROME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
var FIREFOX_RE = /^(?:(.+?)@)?(.+?):(\d+)(?::(\d+))?\s*$/;
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

// src/core.ts
function buildEnvelope(event, projectId) {
  const eventJson = JSON.stringify(event);
  const header = JSON.stringify({ sent_at: (/* @__PURE__ */ new Date()).toISOString() });
  const itemHeader = JSON.stringify({ type: "event", length: eventJson.length });
  return `${header}
${itemHeader}
${eventJson}
`;
}
function parseUa() {
  const ua = navigator.userAgent;
  let browserName = "Unknown";
  let browserVersion = "";
  let osName = "Unknown";
  let osVersion = "";
  if (/Edg\//.test(ua)) {
    browserName = "Edge";
    browserVersion = (ua.match(/Edg\/([\d.]+)/) || [])[1] || "";
  } else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
    browserName = "Chrome";
    browserVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || "";
  } else if (/Firefox\//.test(ua)) {
    browserName = "Firefox";
    browserVersion = (ua.match(/Firefox\/([\d.]+)/) || [])[1] || "";
  } else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
    browserName = "Safari";
    browserVersion = (ua.match(/Version\/([\d.]+)/) || [])[1] || "";
  }
  if (/Mac OS X ([\d_]+)/.test(ua)) {
    osName = "macOS";
    osVersion = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") || "";
  } else if (/Windows NT ([\d.]+)/.test(ua)) {
    osName = "Windows";
    osVersion = ua.match(/Windows NT ([\d.]+)/)?.[1] || "";
  } else if (/Linux/.test(ua)) {
    osName = "Linux";
  } else if (/Android ([\d.]+)/.test(ua)) {
    osName = "Android";
    osVersion = ua.match(/Android ([\d.]+)/)?.[1] || "";
  } else if (/iPhone OS ([\d_]+)/.test(ua)) {
    osName = "iOS";
    osVersion = ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") || "";
  }
  return {
    browser: { name: browserName, version: browserVersion },
    os: { name: osName, version: osVersion }
  };
}
var sourceCache = /* @__PURE__ */ new Map();
async function fetchSourceLines(url) {
  if (sourceCache.has(url)) return sourceCache.get(url);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2e3);
    const resp = await fetch(url, { signal: ac.signal, credentials: "omit" });
    clearTimeout(timer);
    if (!resp.ok) {
      sourceCache.set(url, null);
      return null;
    }
    const text = await resp.text();
    const lines = text.split("\n");
    sourceCache.set(url, lines);
    return lines;
  } catch {
    sourceCache.set(url, null);
    return null;
  }
}
var CONTEXT_LINES = 5;
async function enrichFrames(frames) {
  const urls = [...new Set(
    frames.map((f) => f.filename).filter((fn) => fn && /^https?:\/\//.test(fn))
  )];
  const sourceMap = /* @__PURE__ */ new Map();
  await Promise.all(urls.map(async (url) => {
    sourceMap.set(url, await fetchSourceLines(url));
  }));
  return frames.map((f) => {
    const lines = sourceMap.get(f.filename) ?? null;
    if (!lines || !f.lineno) return f;
    const idx = f.lineno - 1;
    return {
      ...f,
      pre_context: lines.slice(Math.max(0, idx - CONTEXT_LINES), idx),
      context_line: lines[idx],
      post_context: lines.slice(idx + 1, idx + 1 + CONTEXT_LINES)
    };
  });
}
function toError(value) {
  if (value instanceof Error) return value;
  if (value === null || value === void 0) return null;
  const msg = typeof value === "string" ? value : typeof value === "object" ? String(value.message || JSON.stringify(value)) : String(value);
  const err = new Error(msg);
  err.name = typeof value === "object" && value.name ? String(value.name) : "UnknownError";
  return err;
}
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
var CentryClient = class {
  constructor(config) {
    this.recentErrors = /* @__PURE__ */ new Set();
    this.config = config;
    this.url = envelopeUrl(config.project);
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 6e4);
  }
  /** Capture a manually-caught exception (handled = true). */
  captureException(error) {
    void this._capture(error, true);
  }
  /** Internal: capture an unhandled exception (handled = false). Used by globalHandlers. */
  captureUnhandled(error) {
    void this._capture(error, false);
  }
  async _capture(error, handled) {
    try {
      if (this.config.enabled === false) return;
      if (typeof window === "undefined") return;
      const err = toError(error);
      if (!err) return;
      if (err.message === "Script error." || err.message === "Script error") return;
      const dedupKey = `${err.name}:${err.message}:${err.stack?.slice(0, 150) ?? ""}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
      const frames = err.stack ? parseStack(err.stack) : [];
      const allowUrls = this.config.allowUrls;
      const rawFrames = frames.map((f) => ({
        ...f,
        in_app: !allowUrls || allowUrls.some((re) => re.test(f.filename))
      }));
      const enrichedFrames = await enrichFrames(rawFrames);
      const { browser, os } = parseUa();
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        environment: this.config.environment,
        release: this.config.release,
        breadcrumbs: { values: [] },
        exception: {
          values: [{
            type: err.name || "Error",
            value: err.message,
            mechanism: { type: handled ? "generic" : "onerror", handled },
            stacktrace: { frames: enrichedFrames }
          }]
        },
        contexts: {
          browser,
          os,
          page: {
            url: location.href,
            "http.query": location.search,
            referer: document.referrer
          },
          runtime: { name: "javascript" }
        }
      };
      this.send(event);
    } catch {
    }
  }
  send(event) {
    try {
      const envelope = buildEnvelope(event, this.config.project);
      const blob = new Blob([envelope], { type: "text/plain" });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(this.url, blob);
      } else {
        fetch(this.url, {
          method: "POST",
          body: envelope,
          headers: { "Content-Type": "text/plain" },
          keepalive: true
        }).catch(() => {
        });
      }
    } catch {
    }
  }
};
var _client = null;
function init(config) {
  _client = new CentryClient(config);
  return _client;
}
function captureException(error) {
  _client?.captureException(error);
}
function getClient() {
  return _client;
}

// src/integrations/globalHandlers.ts
function installGlobalHandlers(client) {
  if (typeof window === "undefined") return () => {
  };
  const seen = /* @__PURE__ */ new WeakSet();
  const onError = (_message, _source, _lineno, _colno, error) => {
    if (error && !seen.has(error)) {
      seen.add(error);
      client.captureUnhandled(error);
    }
    return false;
  };
  const onUnhandledRejection = (event) => {
    const error = event.reason;
    if (error instanceof Error && !seen.has(error)) {
      seen.add(error);
      client.captureUnhandled(error);
    } else if (typeof error === "string") {
      client.captureUnhandled(new Error(error));
    }
  };
  window.addEventListener("error", (e) => onError(e.message, e.filename, e.lineno, e.colno, e.error));
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

// src/CentryProvider.tsx
function CentryProvider({ children, ...config }) {
  (0, import_react.useEffect)(() => {
    const client = init(config);
    const cleanup = installGlobalHandlers(client);
    return cleanup;
  }, [config.project]);
  return children;
}

// src/worker.ts
function buildEnvelope2(event) {
  const eventJson = JSON.stringify(event);
  const header = JSON.stringify({ sent_at: (/* @__PURE__ */ new Date()).toISOString() });
  const itemHeader = JSON.stringify({ type: "event", length: eventJson.length });
  return `${header}
${itemHeader}
${eventJson}
`;
}
function toError2(value) {
  if (value instanceof Error) return value;
  if (value === null || value === void 0) return null;
  const msg = typeof value === "string" ? value : typeof value === "object" ? String(value.message || JSON.stringify(value)) : String(value);
  const err = new Error(msg);
  err.name = typeof value === "object" && value.name ? String(value.name) : "UnknownError";
  return err;
}
function buildRequestContext(request) {
  const headers = {};
  const SAFE_HEADERS = ["accept", "content-type", "user-agent", "referer", "cf-ray", "cf-connecting-ip"];
  for (const key of SAFE_HEADERS) {
    const val = request.headers.get(key);
    if (val) headers[key] = val;
  }
  return { method: request.method, url: request.url, headers };
}
var RateLimiter2 = class {
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
var WorkerClient = class {
  constructor(config) {
    this.recentErrors = /* @__PURE__ */ new Set();
    this.config = config;
    this.url = envelopeUrl(config.project);
    this.rateLimiter = new RateLimiter2(config.maxEventsPerMinute ?? 10, 6e4);
  }
  /**
   * Capture a caught exception. Optionally pass the `Request` explicitly —
   * if omitted and withCentry() is being used, the request is picked up
   * automatically from AsyncLocalStorage context.
   */
  captureException(error, request) {
    void this._capture(error, true, request ?? getAls()?.getStore());
  }
  /** For use in unhandled rejection / uncaughtException hooks. */
  captureUnhandled(error, request) {
    void this._capture(error, false, request ?? getAls()?.getStore());
  }
  async _capture(error, handled, request) {
    try {
      if (this.config.enabled === false) return;
      const err = toError2(error);
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
          runtime: { name: "cloudflare-worker" }
        }
      };
      if (request) {
        event["request"] = buildRequestContext(request);
      }
      await this._send(event);
    } catch {
    }
  }
  async _send(event) {
    try {
      const envelope = buildEnvelope2(event);
      await fetch(this.url, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "text/plain" }
      });
    } catch {
    }
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
        originalFetch(
          request,
          env,
          ctx
        )
      ).catch((err) => {
        client.captureUnhandled(err, request);
        throw err;
      });
      return als ? als.run(request, run) : run();
    };
  }
  if (handler.scheduled) {
    const originalScheduled = handler.scheduled;
    wrapped.scheduled = async (event, env, ctx) => {
      try {
        await originalScheduled(
          event,
          env,
          ctx
        );
      } catch (err) {
        client.captureUnhandled(err);
        throw err;
      }
    };
  }
  return wrapped;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CentryClient,
  CentryProvider,
  WorkerClient,
  captureException,
  captureWorkerException,
  getClient,
  getWorkerClient,
  init,
  initWorker,
  installGlobalHandlers,
  withCentry
});
