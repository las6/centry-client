export const sensitiveKeys = [
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
  "id_token",
];

/**
 * Redacts sensitive query parameters, Basic Auth credentials (username and password),
 * and query-style URL fragments from a URL string by replacing values with a literal
 * '[filtered]' string.
 */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return "";

  try {
    const isSearch = urlStr.startsWith("?");
    // Use a dummy base for relative URLs and search strings
    const url = new URL(urlStr, "http://dummy.com");

    let hasSensitive = false;

    // 1. Basic Auth credentials (username and password)
    if (url.username) {
      url.username = "[filtered]";
      hasSensitive = true;
    }
    if (url.password) {
      url.password = "[filtered]";
      hasSensitive = true;
    }

    // 2. Query parameters
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, "[filtered]");
        hasSensitive = true;
      }
    }

    // 3. Query-style URL fragments (e.g., #access_token=secret)
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

    // Post-process output to ensure the redaction string is not URL-encoded as '%5Bfiltered%5D'
    return result.replace(/%5Bfiltered%5D/gi, "[filtered]");
  } catch {
    return urlStr;
  }
}
