/**
 * apiClient.js
 *
 * Generic JSON API fetch helper for REST-API-based email providers.
 *
 * Exports:
 *   makeApi(baseUrl, defaultOpts?) — returns a fetch helper bound to baseUrl
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Retries with exponential backoff for transient failures (5xx, connection errors).
async function apiFetchWithRetry(baseUrl, path, opts = {}, attempt = 1) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: opts.method || "GET",
      headers: opts.headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      // Don't retry on 4xx errors (client errors), only 5xx (server errors)
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
        console.warn(
          `[apiClient] ${opts.method || "GET"} ${path} returned ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return apiFetchWithRetry(baseUrl, path, opts, attempt + 1);
      }

      // Extract error detail
      let detail = "";
      try {
        const j = await res.json();
        detail = opts.errorDetail?.(j) ?? j.message ?? JSON.stringify(j);
      } catch (_) {}
      throw new Error(
        `[apiClient] ${opts.method || "GET"} ${baseUrl}${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    return res.status === 204 ? null : res.json();
  } catch (err) {
    // Retry on network errors (connection refused, timeout, etc)
    if (attempt < MAX_RETRIES && (err instanceof TypeError || err instanceof Error)) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
      console.warn(
        `[apiClient] ${opts.method || "GET"} ${path} failed: ${err.message}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return apiFetchWithRetry(baseUrl, path, opts, attempt + 1);
    }
    throw err;
  }
}

// Fetches a JSON endpoint. Injects a token when provided,
// throws on non-2xx, and returns null on 204 No Content.
async function apiFetch(baseUrl, path, opts = {}) {
  const {
    method = "GET",
    token = null,
    body = null,
    errorDetail = null,
  } = opts;

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": DEFAULT_UA,
    "Accept": "application/json, */*",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return apiFetchWithRetry(baseUrl, path, {
    method,
    headers,
    body,
    errorDetail,
  });
}

// Returns a fetch helper pre-bound to baseUrl.
// defaultOpts sets call-wide defaults (e.g. a custom errorDetail for Hydra responses).
export function makeApi(baseUrl, defaultOpts = {}) {
  return (path, callOpts) =>
    apiFetch(baseUrl, path, { ...defaultOpts, ...callOpts });
}