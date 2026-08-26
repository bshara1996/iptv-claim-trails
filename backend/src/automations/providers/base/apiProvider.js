/**
 * base/apiProvider.js
 *
 * Shared infrastructure for REST-API-based email providers.
 *
 * Exports:
 *   makeApi(baseUrl)          — returns a fetch helper pre-bound to baseUrl
 *   createProviderMethods(tag, getReader) — generates the three inbox-polling methods
 */

import logger from "../../../logger.js";
import { apiFetch } from "../../utils/apiFetch.js";
import {
  pollApi,
  extractLinks,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "../../inbox/index.js";

// ── makeApi ───────────────────────────────────────────────────────────────────

// Returns a fetch helper bound to baseUrl so providers don't repeat the base URL on every call.
export function makeApi(baseUrl) {
  return (path, opts) => apiFetch(baseUrl, path, opts);
}

// ── createProviderMethods ─────────────────────────────────────────────────────

// Generates the three shared inbox-polling methods for any API-based provider.
// Each method resolves the inbox reader via getReader, then delegates to pollApi.
export function createProviderMethods(tag, getReader) {
  // Resolves the reader from the page and delegates to the generic API poller.
  function _poll(page, opts, onRow) {
    return pollApi(getReader(page), opts, onRow);
  }

  return {
    // Polls the inbox until an email containing a 6-digit verification code arrives.
    async waitForVerificationCodeEmail(
      page,
      {
        filterText = "",
        seenIds = new Set(),
        codeRe = /\b(\d{6})\b/,
        timeout = 120_000,
      } = {},
    ) {
      logger.info(`[${tag}] Polling inbox for verification code...`);

      const result = await _poll(
        page,
        { filterText, seenIds, timeout },
        async (content, preview) => {
          const code = codeRe.exec(preview)?.[1] ?? codeRe.exec(content)?.[1];
          if (code) logger.info(`[${tag}] Code found: ${code}`);
          else logger.info(`[${tag}] No code in this email — skipping.`);
          return code ?? null;
        },
      );

      if (!result)
        logger.warn(`[${tag}] Timed out waiting for verification code.`);
      return result;
    },

    // Polls the inbox until a matching email arrives, then returns the first URL (or the one matching pattern).
    async waitForEmailAndExtractLink(
      page,
      {
        filterText = "",
        pattern = null,
        seenIds = new Set(),
        timeout = 120_000,
      } = {},
    ) {
      logger.info(
        `[${tag}] Waiting for link email${filterText ? ` matching "${filterText}"` : ""}...`,
      );

      const result = await _poll(
        page,
        { filterText, seenIds, timeout },
        async (content, preview) => {
          const links = extractLinks(content);
          const match = pattern
            ? links.find((l) => pattern.test(l))
            : (links[0] ?? null);

          if (match) logger.info(`[${tag}] Extracted link: ${match}`);
          else
            logger.warn(
              `[${tag}] No usable link in email (preview: "${preview.slice(0, 80)}") — skipping.`,
            );
          return match ?? null;
        },
      );

      if (!result)
        logger.warn(
          `[${tag}] Timed out waiting for email${filterText ? ` matching "${filterText}"` : ""}.`,
        );
      return result;
    },

    // Polls the inbox until an email with M3U playlist links arrives, then returns the extracted playlists.
    async waitForEmailAndExtractPlaylists(
      page,
      { filterText = "", seenIds = new Set(), timeout = 120_000 } = {},
    ) {
      logger.info(
        `[${tag}] Polling inbox for playlist email${filterText ? ` matching "${filterText}"` : ""}...`,
      );

      const result = await _poll(
        page,
        { filterText, seenIds, timeout },
        async (content) => {
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

      if (!result)
        logger.warn(`[${tag}] Timed out waiting for playlist email.`);
      return result ?? EMPTY_PLAYLISTS;
    },
  };
}
