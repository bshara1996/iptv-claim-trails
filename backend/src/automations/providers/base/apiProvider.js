/**
 * base/apiProvider.js
 *
 * Shared infrastructure for REST-API-based email providers.
 *
 * Exports:
 *   makeApi(baseUrl, opts?)          — fetch helper pre-bound to baseUrl
 *   makeGetReader(pageKey, tag, fn)  — guard wrapper that reads credentials from the page stub
 *   createProviderMethods(tag, getReader) — generates the three shared inbox-polling methods
 */

import logger from "../../../logger.js";
import {
  pollApi,
  extractLinks,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "../../inbox/index.js";

// ── HTTP ──────────────────────────────────────────────────────────────────────

// Generic fetch wrapper: injects auth header, throws on non-2xx, returns null on 204.
// opts.errorDetail(json) — optional hook for provider-specific error message extraction.
async function apiFetch(
  baseUrl,
  path,
  { method = "GET", token = null, body = null, errorDetail = null } = {},
) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = errorDetail?.(j) ?? j.message ?? JSON.stringify(j);
    } catch (_) {}
    throw new Error(
      `[apiFetch] ${method} ${baseUrl}${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return res.status === 204 ? null : res.json(); // null on No Content
}

// Returns a fetch helper bound to baseUrl. Any per-request options (token, body, errorDetail)
// are passed through on each call. makeApiOpts can set defaults for all calls (e.g. errorDetail).
export function makeApi(baseUrl, makeApiOpts = {}) {
  return (path, callOpts) =>
    apiFetch(baseUrl, path, { ...makeApiOpts, ...callOpts });
}

// ── Credential helper ─────────────────────────────────────────────────────────

// Guards against polling before createEmail has run by checking the credential on the page stub.
export function makeGetReader(pageKey, tag, buildReader) {
  return function getReader(page) {
    const credential = page[pageKey];
    if (!credential)
      throw new Error(`[${tag}] No ${pageKey} — call createEmail first.`);
    return buildReader(credential);
  };
}

// ── Provider method factory ───────────────────────────────────────────────────

// Generates the three shared inbox-polling methods for any API-based provider.
// getReader(page) resolves the inbox reader lazily — credentials are stashed on
// the page stub by createEmail and retrieved here when polling starts.
export function createProviderMethods(tag, getReader) {
  // Logs start, delegates to pollApi, logs on timeout.
  async function _run(page, startMsg, timeoutMsg, opts, onRow) {
    logger.info(`[${tag}] ${startMsg}`);
    const result = await pollApi(getReader(page), opts, onRow);
    if (!result) logger.warn(`[${tag}] ${timeoutMsg}`);
    return result;
  }

  return {
    // Polls until an email with a 6-digit verification code arrives.
    async waitForVerificationCodeEmail(
      page,
      {
        filterText = "",
        seenIds = new Set(),
        codeRe = /\b(\d{6})\b/,
        timeout = 120_000,
      } = {},
    ) {
      return _run(
        page,
        "Polling inbox for verification code...",
        "Timed out waiting for verification code.",
        { filterText, seenIds, timeout },
        (content, preview) => {
          const code =
            codeRe.exec(preview)?.[1] ?? codeRe.exec(content)?.[1] ?? null;
          logger.info(
            code
              ? `[${tag}] Code found: ${code}`
              : `[${tag}] No code in this email — skipping.`,
          );
          return code;
        },
      );
    },

    // Polls until a matching email arrives, then returns the first URL (or the one matching pattern).
    async waitForEmailAndExtractLink(
      page,
      {
        filterText = "",
        pattern = null,
        seenIds = new Set(),
        timeout = 120_000,
      } = {},
    ) {
      return _run(
        page,
        `Waiting for link email${filterText ? ` matching "${filterText}"` : ""}...`,
        `Timed out waiting for email${filterText ? ` matching "${filterText}"` : ""}.`,
        { filterText, seenIds, timeout },
        (content, preview) => {
          const links = extractLinks(content);
          const match =
            (pattern ? links.find((l) => pattern.test(l)) : links[0]) ?? null;
          if (match) logger.info(`[${tag}] Extracted link: ${match}`);
          else
            logger.warn(
              `[${tag}] No usable link in email (preview: "${preview.slice(0, 80)}") — skipping.`,
            );
          return match;
        },
      );
    },

    // Polls until an email with M3U playlist links arrives, then returns the extracted playlists.
    async waitForEmailAndExtractPlaylists(
      page,
      { filterText = "", seenIds = new Set(), timeout = 120_000 } = {},
    ) {
      const result = await _run(
        page,
        `Polling inbox for playlist email${filterText ? ` matching "${filterText}"` : ""}...`,
        "Timed out waiting for playlist email.",
        { filterText, seenIds, timeout },
        (content) => {
          const playlists = extractPlaylists(content);
          if (!playlists) {
            logger.info(`[${tag}] No M3U links in this email — skipping.`);
            return null;
          }
          logger.info(
            `[${tag}] TV: ${playlists.tvPlaylist}, VOD: ${playlists.vodPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
          );
          if (playlists.duration)
            logger.info(
              `[${tag}] Duration: ${playlists.duration}${playlists.expiresAt ? ` · expires: ${playlists.expiresAt}` : ""}`,
            );
          return playlists;
        },
      );
      // Never return null — callers expect a destructurable object.
      return result ?? EMPTY_PLAYLISTS;
    },
  };
}
