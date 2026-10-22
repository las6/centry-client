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

// src/index.node.ts
var index_node_exports = {};
__export(index_node_exports, {
  NodeClient: () => NodeClient,
  captureException: () => captureException,
  captureMessage: () => captureMessage,
  getNodeClient: () => getNodeClient,
  initNode: () => initNode,
  installNodeGlobalHandlers: () => installNodeGlobalHandlers,
  withCentry: () => withCentry
});
module.exports = __toCommonJS(index_node_exports);

// src/node.ts
var import_node_async_hooks = require("async_hooks");

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

// src/_shared/toError.ts
function toError(value) {
  if (value instanceof Error) return value;
  if (value === null || value === void 0) return null;
  const msg = typeof value === "string" ? value : typeof value === "object" ? String(value.message || safeStringify(value)) : String(value);
  const err = new Error(msg);
  err.name = typeof value === "object" && value.name ? String(value.name) : "UnknownError";
  return err;
}
function safeStringify(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[Unserializable thrown value]";
  }
}

// src/_shared/exceptionValues.ts
function buildExceptionValues(error, handled) {
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  let current = error;
  let truncated = false;
  while (current != null) {
    if (seen.has(current) || values.length === 5) {
      truncated = true;
      break;
    }
    seen.add(current);
    const err = toError(current);
    if (!err) break;
    const primary = values.length === 0;
    values.unshift({
      type: err.name || "Error",
      value: err.message,
      mechanism: { type: primary ? handled ? "generic" : "onerror" : "cause", handled: primary ? handled : true },
      stacktrace: { frames: err.stack ? parseStack(err.stack) : [] }
    });
    try {
      current = typeof current === "object" ? current.cause : void 0;
    } catch {
      truncated = true;
      break;
    }
  }
  return { values, truncated };
}

// src/_shared/browserEventPayload.ts
var MAX_EVENT_BYTES = 48 * 1024;
var MAX_ENVELOPE_BYTES = 60 * 1024;
var MAX_FRAMES = 30;
var MAX_BREADCRUMBS = 40;
var MAX_BREADCRUMB_BYTES = 8 * 1024;
var MAX_STRING_BYTES = 1024;
var MAX_URL_BYTES = 1536;
var MAX_TAG_VALUE_BYTES = 256;
var MAX_OBJECT_DEPTH = 5;
var MAX_OBJECT_KEYS = 20;
var MAX_ARRAY_ITEMS = 20;
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function byteSize(value) {
  return encoder.encode(value).byteLength;
}
function truncateString(value, maxBytes) {
  if (byteSize(value) <= maxBytes) return value;
  const suffix = "...";
  const suffixBytes = byteSize(suffix);
  const targetBytes = Math.max(0, maxBytes - suffixBytes);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, mid);
    if (byteSize(candidate) <= targetBytes) low = mid;
    else high = mid - 1;
  }
  const trimmed = value.slice(0, low);
  return decoder.decode(encoder.encode(trimmed)) + suffix;
}
function sanitizeValue(value, maxBytes, depth = 0) {
  if (typeof value === "string") return truncateString(value, maxBytes);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) {
    if (depth >= MAX_OBJECT_DEPTH) return [];
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, maxBytes, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_OBJECT_DEPTH) return {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    return Object.fromEntries(entries.map(([key, entry]) => [key, sanitizeValue(entry, maxBytes, depth + 1)]));
  }
  return String(value);
}
function cloneEvent(event) {
  return JSON.parse(JSON.stringify(event));
}
function trimFrames(frames, dropped) {
  if (frames.length > MAX_FRAMES) {
    frames.splice(0, frames.length - MAX_FRAMES);
    dropped.add("frames_head");
  }
  for (const frame of frames) {
    if (typeof frame.filename === "string") frame.filename = truncateString(frame.filename, MAX_URL_BYTES);
    if (typeof frame.function === "string") frame.function = truncateString(frame.function, MAX_STRING_BYTES);
    if (typeof frame.context_line === "string") {
      frame.context_line = truncateString(frame.context_line, 256);
      dropped.add("source_context");
    }
    if (Array.isArray(frame.pre_context)) {
      frame.pre_context = frame.pre_context.slice(-2).map((line) => typeof line === "string" ? truncateString(line, 256) : line);
      dropped.add("source_context");
    }
    if (Array.isArray(frame.post_context)) {
      frame.post_context = frame.post_context.slice(0, 2).map((line) => typeof line === "string" ? truncateString(line, 256) : line);
      dropped.add("source_context");
    }
  }
}
function trimBreadcrumbs(event, dropped) {
  const breadcrumbs = event.breadcrumbs;
  if (!breadcrumbs?.values) return;
  if (breadcrumbs.values.length > MAX_BREADCRUMBS) {
    breadcrumbs.values = breadcrumbs.values.slice(-MAX_BREADCRUMBS);
    dropped.add("breadcrumbs_tail");
  }
  breadcrumbs.values = breadcrumbs.values.map((crumb) => {
    const next = cloneEvent(crumb);
    if (typeof next.message === "string") next.message = truncateString(next.message, 256);
    if (next.data && typeof next.data === "object") next.data = sanitizeValue(next.data, MAX_URL_BYTES);
    if (typeof next.category === "string") next.category = truncateString(next.category, 128);
    if (typeof next.type === "string") next.type = truncateString(next.type, 64);
    if (typeof next.level === "string") next.level = truncateString(next.level, 32);
    return next;
  });
  while (breadcrumbs.values.length > 0 && byteSize(JSON.stringify(breadcrumbs.values)) > MAX_BREADCRUMB_BYTES) {
    breadcrumbs.values.shift();
    dropped.add("breadcrumbs_tail");
  }
  if (breadcrumbs.values.length === 0) delete event.breadcrumbs;
}
function sanitizeTopLevel(event, dropped) {
  if (typeof event.message === "string") event.message = truncateString(event.message, MAX_STRING_BYTES);
  if (typeof event.release === "string") event.release = truncateString(event.release, 128);
  if (typeof event.environment === "string") event.environment = truncateString(event.environment, 64);
  const exceptionValues = event.exception?.values ?? [];
  if (exceptionValues.length > 5) {
    exceptionValues.splice(1, exceptionValues.length - 5);
    dropped.add("cause_chain");
  }
  for (const exc of exceptionValues) {
    if (typeof exc.type === "string") exc.type = truncateString(exc.type, 128);
    if (typeof exc.value === "string") exc.value = truncateString(exc.value, MAX_STRING_BYTES);
    const stacktrace = exc.stacktrace;
    const frames = stacktrace?.frames ?? [];
    trimFrames(frames, dropped);
  }
  const tags = event.tags;
  if (tags) {
    event.tags = Object.fromEntries(
      Object.entries(tags).slice(0, MAX_OBJECT_KEYS).map(([key, value]) => [key, sanitizeValue(value, MAX_TAG_VALUE_BYTES)])
    );
  }
  if (event.extra) {
    event.extra = sanitizeValue(event.extra, 256);
    dropped.add("extra");
  }
  if (event.user) event.user = sanitizeValue(event.user, 256);
  if (event.request) event.request = sanitizeValue(event.request, MAX_URL_BYTES);
  if (event.contexts) event.contexts = sanitizeValue(event.contexts, MAX_URL_BYTES);
}
function attachTrimMetadata(event, dropped, originalSize, finalSize) {
  if (dropped.size === 0 && originalSize === finalSize) return;
  const debugMeta = event.debug_meta ?? {};
  const centry = debugMeta.centry ?? {};
  centry.payload_trimmed = true;
  centry.dropped = [...dropped];
  centry.original_size = originalSize;
  centry.final_size = finalSize;
  debugMeta.centry = centry;
  event.debug_meta = debugMeta;
}
function shrinkForBudget(event, dropped) {
  const breadcrumbs = event.breadcrumbs;
  if (breadcrumbs?.values?.length) {
    breadcrumbs.values = breadcrumbs.values.slice(-10);
    dropped.add("breadcrumbs_tail");
  }
  const exceptionValues = event.exception?.values ?? [];
  for (const exc of exceptionValues) {
    const stacktrace = exc.stacktrace;
    const frames = stacktrace?.frames ?? [];
    if (frames.length > 15) {
      frames.splice(0, frames.length - 15);
      dropped.add("frames_head");
    }
    for (const frame of frames) {
      delete frame.context_line;
      delete frame.pre_context;
      delete frame.post_context;
    }
  }
  if (exceptionValues.length > 2) {
    exceptionValues.splice(1, exceptionValues.length - 2);
    dropped.add("cause_chain");
  }
  for (const exc of exceptionValues.slice(0, -1)) {
    delete exc.stacktrace;
    dropped.add("cause_frames");
  }
  delete event.extra;
  delete event.user;
  delete event.request;
}
function prepareBrowserEventForTransport(event) {
  const originalJson = JSON.stringify(event);
  const originalSize = byteSize(originalJson);
  const next = cloneEvent(event);
  const dropped = /* @__PURE__ */ new Set();
  sanitizeTopLevel(next, dropped);
  trimBreadcrumbs(next, dropped);
  let eventJson = JSON.stringify(next);
  if (byteSize(eventJson) > MAX_EVENT_BYTES) {
    shrinkForBudget(next, dropped);
    eventJson = JSON.stringify(next);
  }
  attachTrimMetadata(next, dropped, originalSize, byteSize(eventJson));
  eventJson = JSON.stringify(next);
  if (byteSize(eventJson) > MAX_EVENT_BYTES) {
    return { event: null, eventSize: byteSize(eventJson), envelopeSize: 0, dropped: [...dropped], originalSize };
  }
  const header = JSON.stringify({ sent_at: (/* @__PURE__ */ new Date()).toISOString() });
  const itemHeader = JSON.stringify({ type: "event", length: byteSize(eventJson) });
  const envelopeSize = byteSize(`${header}
${itemHeader}
${eventJson}
`);
  if (envelopeSize > MAX_ENVELOPE_BYTES) {
    return { event: null, eventSize: byteSize(eventJson), envelopeSize, dropped: [...dropped], originalSize };
  }
  return {
    event: next,
    eventSize: byteSize(eventJson),
    envelopeSize,
    dropped: [...dropped],
    originalSize
  };
}

// src/types.ts
var CENTRY_HOST = "https://centry.pages.dev";
function envelopeUrl(project, host = CENTRY_HOST) {
  return `${host.replace(/\/$/, "")}/api/${encodeURIComponent(project)}/envelope/`;
}

// src/_shared/envelope.ts
function buildEnvelope(event) {
  const eventJson = JSON.stringify(event);
  const header = JSON.stringify({ sent_at: (/* @__PURE__ */ new Date()).toISOString() });
  const itemHeader = JSON.stringify({ type: "event", length: new TextEncoder().encode(eventJson).byteLength });
  return `${header}
${itemHeader}
${eventJson}
`;
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
var FILTERED = "[filtered]";
function scrubUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return urlStr;
  try {
    let scrubbed = urlStr;
    scrubbed = scrubbed.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, `://${FILTERED}:${FILTERED}@`);
    scrubbed = scrubbed.replace(/:\/\/([^:@\s]+)@/g, `://${FILTERED}@`);
    for (const key of sensitiveKeys) {
      const regex = new RegExp(`([?&,#]${key}=)[^&#]*`, "gi");
      scrubbed = scrubbed.replace(regex, `$1${FILTERED}`);
    }
    return scrubbed.replace(/%5Bfiltered%5D/gi, FILTERED);
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
      if (val) {
        headers[key] = key === "referer" ? scrubUrl(val) : val;
      }
    }
    return { method: request.method, url: scrubUrl(request.url), headers };
  }
  const r = req;
  if (r.headers && typeof r.headers === "object") {
    const headers = {};
    for (const key of SAFE_HEADERS) {
      let val = r.headers[key];
      if (typeof val === "string") {
        headers[key] = key === "referer" ? scrubUrl(val) : val;
      }
    }
    return {
      method: r.method,
      url: r.url ? scrubUrl(r.url) : r.url,
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
    this.url = envelopeUrl(config.project, config.host);
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
      const chain = buildExceptionValues(error, handled);
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        environment: this.config.environment,
        release: this.config.release,
        exception: { values: chain.values },
        ...chain.truncated ? { debug_meta: { centry: { cause_chain_truncated: true } } } : {},
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
      const filtered = this.config.beforeSend ? this.config.beforeSend(event) : event;
      if (!filtered || typeof filtered !== "object" || Array.isArray(filtered) || typeof filtered.then === "function") return;
      const prepared = prepareBrowserEventForTransport(filtered);
      if (!prepared.event) {
        this.config.onSendError?.(new Error("Event exceeded transport budget"), prepared.originalSize, "payload_too_large");
        return;
      }
      const envelope = buildEnvelope(prepared.event);
      const p = fetch(this.url, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "text/plain" }
      }).then((response) => {
        if (!response.ok) this.config.onSendError?.(new Error(`Ingest responded with HTTP ${response.status}`), prepared.envelopeSize, "http_error");
      }).catch(() => {
        try {
          this.config.onSendError?.(new Error("Event transport failed"), prepared.envelopeSize, "network_error");
        } catch {
        }
      }).finally(() => this._pending.delete(p));
      this._pending.add(p);
    } catch {
    }
  }
};

// src/node.ts
var _als = new import_node_async_hooks.AsyncLocalStorage();
var NodeClient = class extends BaseServerClient {
  constructor(config) {
    super(config);
  }
  getStore() {
    return _als.getStore();
  }
  get runtimeContext() {
    return { name: "node", version: process.version };
  }
};
function installNodeGlobalHandlers(client) {
  const onUncaughtException = (error) => {
    client.captureUnhandled(error);
  };
  const onUnhandledRejection = (reason) => {
    client.captureUnhandled(reason);
  };
  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);
  return () => {
    process.off("uncaughtException", onUncaughtException);
    process.off("unhandledRejection", onUnhandledRejection);
  };
}
var _nodeClient = null;
var _removeGlobalHandlers = null;
function initNode(config) {
  _removeGlobalHandlers?.();
  _nodeClient = new NodeClient(config);
  _removeGlobalHandlers = installNodeGlobalHandlers(_nodeClient);
  return _nodeClient;
}
function captureException(error) {
  _nodeClient?.captureException(error);
}
function captureMessage(message, level = "info") {
  _nodeClient?.captureMessage(message, level);
}
function getNodeClient() {
  return _nodeClient;
}
function withCentry(config, handler) {
  const client = initNode(config);
  return async (...args) => {
    const maybeRequest = args[0];
    const run = async () => {
      try {
        return await handler(...args);
      } catch (err) {
        client.captureUnhandled(err);
        throw err;
      } finally {
        await client.flush();
      }
    };
    if (maybeRequest && typeof maybeRequest === "object") {
      return _als.run(maybeRequest, run);
    }
    return run();
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NodeClient,
  captureException,
  captureMessage,
  getNodeClient,
  initNode,
  installNodeGlobalHandlers,
  withCentry
});
