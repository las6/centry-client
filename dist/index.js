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
var src_exports = {};
__export(src_exports, {
  CentryClient: () => CentryClient,
  CentryProvider: () => CentryProvider,
  captureException: () => captureException,
  captureMessage: () => captureMessage,
  getClient: () => getClient,
  init: () => init,
  installGlobalHandlers: () => installGlobalHandlers
});
module.exports = __toCommonJS(src_exports);

// src/CentryProvider.tsx
var import_react = require("react");

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

// src/utils.ts
function scrubUrl(urlStr) {
  if (!urlStr) return "";
  try {
    const isSearch = urlStr.startsWith("?");
    const url = new URL(urlStr, "http://dummy.com");
    let hasSensitive = false;
    const sensitiveKeys = [
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
      "credential"
    ];
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, "[filtered]");
        hasSensitive = true;
      }
    }
    if (!hasSensitive) return urlStr;
    if (isSearch) {
      return "?" + url.searchParams.toString();
    }
    const result = url.toString();
    if (/^https?:\/\//i.test(urlStr)) {
      return result;
    }
    if (result.startsWith("http://dummy.com/")) {
      const relative = result.substring("http://dummy.com/".length);
      return (urlStr.startsWith("/") ? "/" : "") + relative;
    }
    return result;
  } catch {
    return urlStr;
  }
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

// src/integrations/globalHandlers.ts
var GLOBAL_HANDLERS_STATE = /* @__PURE__ */ Symbol.for("centry.globalHandlers");
function getState() {
  if (typeof window === "undefined") {
    return {
      initClient: null,
      installed: false,
      manualInstallId: 0,
      manualClients: /* @__PURE__ */ new Map(),
      seen: /* @__PURE__ */ new WeakSet()
    };
  }
  const globalWindow = window;
  globalWindow[GLOBAL_HANDLERS_STATE] ?? (globalWindow[GLOBAL_HANDLERS_STATE] = {
    initClient: null,
    installed: false,
    manualInstallId: 0,
    manualClients: /* @__PURE__ */ new Map(),
    seen: /* @__PURE__ */ new WeakSet()
  });
  return globalWindow[GLOBAL_HANDLERS_STATE];
}
function getActiveClient() {
  const state = getState();
  let latestManualClient = null;
  for (const client of state.manualClients.values()) latestManualClient = client;
  return latestManualClient ?? state.initClient;
}
function onError(event) {
  const error = event.error;
  const state = getState();
  if (error instanceof Error && !state.seen.has(error)) {
    state.seen.add(error);
    getActiveClient()?.captureUnhandled(error);
  }
}
function onUnhandledRejection(event) {
  const error = event.reason;
  const state = getState();
  if (error instanceof Error && !state.seen.has(error)) {
    state.seen.add(error);
    getActiveClient()?.captureUnhandled(error);
    return;
  }
  if (typeof error === "string") {
    getActiveClient()?.captureUnhandled(new Error(error));
  }
}
function ensureInstalled() {
  const state = getState();
  if (typeof window === "undefined" || state.installed) return;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  state.installed = true;
}
function maybeUninstall() {
  const state = getState();
  if (typeof window === "undefined") return;
  if (state.initClient || state.manualClients.size > 0 || !state.installed) return;
  window.removeEventListener("error", onError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
  state.installed = false;
}
function syncGlobalHandlers(client) {
  const state = getState();
  state.initClient = client;
  if (client) {
    ensureInstalled();
    return;
  }
  maybeUninstall();
}
function installGlobalHandlers(client) {
  if (typeof window === "undefined") return () => {
  };
  const state = getState();
  const installId = ++state.manualInstallId;
  state.manualClients.set(installId, client);
  ensureInstalled();
  return () => {
    state.manualClients.delete(installId);
    maybeUninstall();
  };
}

// src/core.ts
var import_meta = {};
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
function normalizeForDedup(url) {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  return /\.[a-z0-9]{2,8}$/i.test(path) ? path : url;
}
var CentryClient = class {
  constructor(config) {
    this.recentErrors = /* @__PURE__ */ new Set();
    this.config = {
      ...config,
      environment: config.environment ?? import_meta.env?.MODE ?? "production"
    };
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
  /**
   * Capture a plain message (non-exception). Level defaults to 'info'.
   *
   * @example
   * import { captureMessage } from 'centry-client'
   * captureMessage('Payment processed', 'info')
   */
  captureMessage(message, level = "info") {
    void this._captureMessage(message, level);
  }
  async _capture(error, handled) {
    try {
      if (this.config.enabled === false) return;
      if (typeof window === "undefined") return;
      const err = toError(error);
      if (!err) return;
      if (err.message === "Script error." || err.message === "Script error") return;
      const frames = err.stack ? parseStack(err.stack) : [];
      const allowUrls = this.config.allowUrls;
      const rawFrames = frames.map((f) => ({
        ...f,
        in_app: !allowUrls || allowUrls.some((re) => re.test(f.filename))
      }));
      const firstFrame = rawFrames.find((f) => f.in_app) ?? rawFrames[0];
      const fileKey = firstFrame ? normalizeForDedup(firstFrame.filename) : "";
      const dedupKey = `${err.name}:${err.message}:${fileKey}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
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
            url: scrubUrl(location.href),
            "http.query": scrubUrl(location.search),
            referer: scrubUrl(document.referrer)
          },
          runtime: { name: "javascript" }
        }
      };
      this.send(event);
    } catch {
    }
  }
  async _captureMessage(message, level) {
    try {
      if (this.config.enabled === false) return;
      if (typeof window === "undefined") return;
      if (!message) return;
      const dedupKey = `message:${level}:${message.slice(0, 150)}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
      const { browser, os } = parseUa();
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level,
        environment: this.config.environment,
        release: this.config.release,
        message,
        contexts: {
          browser,
          os,
          page: {
            url: scrubUrl(location.href),
            "http.query": scrubUrl(location.search),
            referer: scrubUrl(document.referrer)
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
      const envelope = buildEnvelope(event);
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
  syncGlobalHandlers(config.globalHandlers === false ? null : _client);
  return _client;
}
function captureException(error) {
  _client?.captureException(error);
}
function captureMessage(message, level = "info") {
  _client?.captureMessage(message, level);
}
function getClient() {
  return _client;
}

// src/CentryProvider.tsx
function CentryProvider({ children, ...config }) {
  (0, import_react.useEffect)(() => {
    init(config);
  }, [config.project]);
  return children;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CentryClient,
  CentryProvider,
  captureException,
  captureMessage,
  getClient,
  init,
  installGlobalHandlers
});
