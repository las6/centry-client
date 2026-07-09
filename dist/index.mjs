// src/CentryProvider.tsx
import { useEffect } from "react";

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
    let changed = false;
    if (url.username) {
      url.username = "[filtered]";
      changed = true;
    }
    if (url.password) {
      url.password = "[filtered]";
      changed = true;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, "[filtered]");
        changed = true;
      }
    }
    if (url.hash.includes("=") && url.hash.length > 1) {
      const hashContent = url.hash.substring(1);
      const hashParams = new URLSearchParams(hashContent);
      let hashChanged = false;
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, "[filtered]");
          hashChanged = true;
        }
      }
      if (hashChanged) {
        url.hash = hashParams.toString();
        changed = true;
      }
    }
    if (!changed) return urlStr;
    let result;
    if (isSearch) {
      result = "?" + url.searchParams.toString();
    } else {
      result = url.toString();
      if (result.startsWith("http://dummy.com/")) {
        result = (urlStr.startsWith("/") ? "/" : "") + result.substring("http://dummy.com/".length);
      } else if (result.startsWith("http://dummy.com")) {
        result = result.substring("http://dummy.com".length);
      }
    }
    return result.replace(/%5Bfiltered%5D/g, "[filtered]");
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
    if (depth >= MAX_OBJECT_DEPTH) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, maxBytes, depth + 1));
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
    if (next.data && typeof next.data === "object") next.data = sanitizeValue(next.data, 256);
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
  if (event.request) event.request = sanitizeValue(event.request, 256);
  if (event.contexts) event.contexts = sanitizeValue(event.contexts, 256);
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
  const itemHeader = JSON.stringify({ type: "event", length: eventJson.length });
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

// src/_shared/sourceContext.ts
var FETCH_TIMEOUT_MS = 1500;
var MAX_CONTEXT_CHARS = 240;
var CONTEXT_LINES = 2;
var sourceCache = /* @__PURE__ */ new Map();
function truncateText(value, maxChars) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}
function sameOriginUrl(filename, pageUrl) {
  if (!filename || !pageUrl) return null;
  try {
    const page = new URL(pageUrl);
    const url = new URL(filename, page.href);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.origin !== page.origin) return null;
    return url.toString();
  } catch {
    return null;
  }
}
async function fetchSourceText(url) {
  const cached = sourceCache.get(url);
  if (cached) return cached;
  const request = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "omit"
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  })();
  sourceCache.set(url, request);
  return request;
}
function extractNormalContext(lines, lineno) {
  const index = lineno - 1;
  const line = lines[index];
  if (line == null) return null;
  return {
    pre_context: lines.slice(Math.max(0, index - CONTEXT_LINES), index).map((entry) => truncateText(entry, MAX_CONTEXT_CHARS)),
    context_line: truncateText(line, MAX_CONTEXT_CHARS),
    post_context: lines.slice(index + 1, index + 1 + CONTEXT_LINES).map((entry) => truncateText(entry, MAX_CONTEXT_CHARS))
  };
}
function extractMinifiedContext(line, colno) {
  const center = Math.max(0, (colno ?? 1) - 1);
  const halfWindow = Math.floor(MAX_CONTEXT_CHARS / 2);
  const start = Math.max(0, center - halfWindow);
  const end = Math.min(line.length, center + halfWindow);
  return {
    context_line: `${start > 0 ? "..." : ""}${line.slice(start, end)}${end < line.length ? "..." : ""}`
  };
}
function buildSourceContext(sourceText, frame) {
  if (!frame.lineno) return null;
  const lines = sourceText.split("\n");
  const maxLineLength = lines.reduce((max, line2) => Math.max(max, line2.length), 0);
  const line = lines[frame.lineno - 1];
  if (line == null) return null;
  const looksMinified = lines.length <= 5 && maxLineLength > 1e3 || line.length > 1e3;
  if (looksMinified) return extractMinifiedContext(line, frame.colno);
  return extractNormalContext(lines, frame.lineno);
}
async function enrichTopFrameWithContext(frames, pageUrl) {
  const targetIndex = (() => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].in_app && sameOriginUrl(frames[i].filename, pageUrl)) return i;
    }
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (sameOriginUrl(frames[i].filename, pageUrl)) return i;
    }
    return -1;
  })();
  if (targetIndex === -1) return frames;
  const frame = frames[targetIndex];
  const url = sameOriginUrl(frame.filename, pageUrl);
  if (!url) return frames;
  const sourceText = await fetchSourceText(url);
  if (!sourceText) return frames;
  const sourceContext = buildSourceContext(sourceText, frame);
  if (!sourceContext) return frames;
  return frames.map((entry, index) => index === targetIndex ? { ...entry, ...sourceContext } : entry);
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
    const now2 = Date.now();
    this.timestamps = this.timestamps.filter((t) => now2 - t < this.windowMs);
    if (this.timestamps.length >= this.max) return false;
    this.timestamps.push(now2);
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

// src/integrations/breadcrumbs.ts
var MAX_BREADCRUMBS2 = 100;
var BreadcrumbBuffer = class {
  constructor() {
    this._buf = [];
  }
  add(crumb) {
    this._buf.push(crumb);
    if (this._buf.length > MAX_BREADCRUMBS2) {
      this._buf.shift();
    }
  }
  snapshot() {
    return [...this._buf];
  }
  clear() {
    this._buf = [];
  }
};
var _buffer = null;
var _cleanupFns = [];
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
var CONSOLE_LEVELS = [
  { method: "debug", level: "debug" },
  { method: "info", level: "info" },
  { method: "warn", level: "warning" },
  { method: "error", level: "error" }
];
function installConsoleInterceptors(buf) {
  const originals = {};
  for (const { method, level } of CONSOLE_LEVELS) {
    const original = console[method].bind(console);
    originals[method] = original;
    console[method] = (...args) => {
      try {
        buf.add({
          timestamp: now(),
          type: "default",
          category: "console",
          level,
          message: args.map((a) => {
            if (typeof a === "string") return a;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          }).join(" ").slice(0, 256)
        });
      } catch {
      }
      original(...args);
    };
  }
  return () => {
    for (const { method } of CONSOLE_LEVELS) {
      if (originals[method]) {
        ;
        console[method] = originals[method];
      }
    }
  };
}
function installNavigationInterceptors(buf) {
  if (typeof window === "undefined" || typeof history === "undefined") return () => {
  };
  let currentUrl = window.location.href;
  function recordNavigation(to) {
    try {
      buf.add({
        timestamp: now(),
        type: "navigation",
        category: "navigation",
        data: {
          from: scrubUrl(currentUrl.replace(window.location.origin, "") || "/"),
          to: scrubUrl(to.startsWith("http") ? to.replace(window.location.origin, "") : to)
        }
      });
      currentUrl = window.location.href;
    } catch {
    }
  }
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function(...args) {
    origPush(...args);
    recordNavigation(typeof args[2] === "string" ? args[2] : window.location.href);
  };
  history.replaceState = function(...args) {
    origReplace(...args);
    recordNavigation(typeof args[2] === "string" ? args[2] : window.location.href);
  };
  function onPopState() {
    recordNavigation(window.location.href);
  }
  window.addEventListener("popstate", onPopState);
  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener("popstate", onPopState);
  };
}
function installFetchInterceptor(buf) {
  if (typeof window === "undefined" || !window.fetch) return () => {
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init2) {
    const startedAt = now();
    let url = "";
    let method = (init2?.method ?? "GET").toUpperCase();
    try {
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else if (input instanceof Request) {
        url = input.url;
        method = (input.method ?? method).toUpperCase();
      }
      url = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "") || "/";
    } catch {
      url = "(unknown)";
    }
    try {
      const response = await originalFetch(input, init2);
      try {
        buf.add({
          timestamp: startedAt,
          type: "http",
          category: "fetch",
          data: { url, method, status_code: response.status }
        });
      } catch {
      }
      return response;
    } catch (err) {
      try {
        buf.add({
          timestamp: startedAt,
          type: "http",
          category: "fetch",
          level: "error",
          data: { url, method, status_code: 0 }
        });
      } catch {
      }
      throw err;
    }
  };
  return () => {
    window.fetch = originalFetch;
  };
}
function installBreadcrumbs() {
  uninstallBreadcrumbs();
  _buffer = new BreadcrumbBuffer();
  _cleanupFns = [
    installConsoleInterceptors(_buffer),
    installNavigationInterceptors(_buffer),
    installFetchInterceptor(_buffer)
  ];
  return _buffer;
}
function uninstallBreadcrumbs() {
  for (const fn of _cleanupFns) {
    try {
      fn();
    } catch {
    }
  }
  _cleanupFns = [];
  _buffer = null;
}
function getBreadcrumbBuffer() {
  return _buffer;
}

// src/core.ts
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
function normalizeForDedup(url) {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  return /\.[a-z0-9]{2,8}$/i.test(path) ? path : url;
}
function isDev() {
  return Boolean(import.meta.env?.DEV);
}
function warnDev(message) {
  if (isDev()) console.warn(message);
}
function getBrowserFetch() {
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window);
  }
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return null;
}
var CentryClient = class {
  constructor(config) {
    this.recentErrors = /* @__PURE__ */ new Set();
    this.config = {
      ...config,
      environment: config.environment ?? import.meta.env?.MODE ?? "production"
    };
    this.url = envelopeUrl(config.project);
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 6e4);
    if (typeof window !== "undefined" && config.enabled !== false) {
      installBreadcrumbs();
    }
  }
  reportSendError(error, payloadSize, reason) {
    try {
      this.config.onSendError?.(error, payloadSize, reason);
    } catch {
    }
    warnDev(`[centry] ${reason}: ${error.message} (${payloadSize} bytes)`);
  }
  /** Tear down interceptors. Called when the client is replaced. */
  destroy() {
    uninstallBreadcrumbs();
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
      const enrichedFrames = await enrichTopFrameWithContext(rawFrames, window.location.href);
      const firstFrame = rawFrames.find((f) => f.in_app) ?? rawFrames[0];
      const fileKey = firstFrame ? normalizeForDedup(firstFrame.filename) : "";
      const dedupKey = `${err.name}:${err.message}:${fileKey}`;
      if (this.recentErrors.has(dedupKey)) return;
      this.recentErrors.add(dedupKey);
      const dedupWindow = this.config.dedupWindowMs ?? 1e4;
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow);
      if (!this.rateLimiter.allow()) return;
      const { browser, os } = parseUa();
      const event = {
        event_id: crypto.randomUUID().replace(/-/g, ""),
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        environment: this.config.environment,
        release: this.config.release,
        breadcrumbs: { values: getBreadcrumbBuffer()?.snapshot() ?? [] },
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
      const prepared = prepareBrowserEventForTransport(event);
      if (!prepared.event) {
        this.reportSendError(new Error("Event exceeded browser transport budget"), prepared.originalSize, "payload_too_large");
        return;
      }
      if (prepared.dropped.length > 0) warnDev(`[centry] trimmed event fields: ${prepared.dropped.join(", ")}`);
      const envelope = buildEnvelope(prepared.event);
      const blob = new Blob([envelope], { type: "text/plain" });
      if (navigator.sendBeacon) {
        const accepted = navigator.sendBeacon(this.url, blob);
        if (accepted) return;
        warnDev(`[centry] beacon_refused: navigator.sendBeacon refused the payload (${prepared.envelopeSize} bytes)`);
      } else {
        warnDev("[centry] sendBeacon unavailable, falling back to fetch");
      }
      const fetchImpl = getBrowserFetch();
      if (!fetchImpl) {
        this.reportSendError(new Error("No fetch implementation available for fallback transport"), prepared.envelopeSize, "send_failed");
        return;
      }
      fetchImpl(this.url, {
        method: "POST",
        body: envelope,
        headers: { "Content-Type": "text/plain" },
        keepalive: true
      }).then((response) => {
        if (!response.ok) {
          this.reportSendError(new Error(`Ingest responded with HTTP ${response.status}`), prepared.envelopeSize, "http_error");
        }
      }).catch((error) => {
        const nextError = error instanceof Error ? error : new Error(String(error));
        this.reportSendError(nextError, prepared.envelopeSize, "network_error");
      });
    } catch {
      this.reportSendError(new Error("Unexpected send failure"), 0, "send_failed");
    }
  }
};
var _client = null;
function init(config) {
  _client?.destroy();
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
  useEffect(() => {
    init(config);
  }, [config.project]);
  return children;
}
export {
  CentryClient,
  CentryProvider,
  captureException,
  captureMessage,
  getClient,
  init,
  installGlobalHandlers
};
