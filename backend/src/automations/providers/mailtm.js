/**
 * Mail.tm disposable email provider.
 *
 * Uses the Mail.tm REST API (https://api.mail.tm) instead of browser automation.
 * Inbox polling is done via pollApi() — no Playwright page needed.
 */
import logger from "../../logger.js";
import {
  pollApi,
  extractLinks,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "../inbox/index.js";
import { apiFetch } from "../utils/apiFetch.js";
import { generateUsername, generatePassword } from "../utils/generators.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.mail.tm";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convenience wrapper that pre-binds the Mail.tm base URL
const api = (path, opts) => apiFetch(BASE_URL, path, opts);

// Builds the reader used by pollApi():
//   fetchMessages() → [{ id, preview }]
//   readMessage(id) → full content string (text + html joined)
function buildReader(token) {
  return {
    async fetchMessages() {
      const data = await api("/messages?page=1", { token });
      return (data["hydra:member"] ?? []).map((msg) => ({
        id: msg.id,
        preview: [
          msg.from?.name ?? "",
          msg.from?.address ?? "",
          msg.subject ?? "",
          msg.intro ?? "",
        ]
          .join(" ")
          .trim(),
      }));
    },

    async readMessage(id) {
      const full = await api(`/messages/${id}`, { token });
      const htmlParts = Array.isArray(full.html)
        ? full.html.join("\n")
        : (full.html ?? "");
      return `${full.text ?? ""}\n${htmlParts}`;
    },
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "mailtm",
    name: "Mail.tm",
    url: BASE_URL,
    description: "Disposable temporary email via Mail.tm API",
    apiOnly: true,
  },

  async createEmail(page) {
    logger.info("[MailTm] Fetching available domains...");
    const domainsData = await api("/domains?page=1");
    const domains = domainsData["hydra:member"] ?? [];
    if (!domains.length) throw new Error("[MailTm] No domains available.");

    const domain = domains[0].domain;
    const address = `${generateUsername()}@${domain}`;
    const password = generatePassword();

    logger.info(`[MailTm] Creating account: ${address}`);
    await api("/accounts", { method: "POST", body: { address, password } });

    logger.info("[MailTm] Requesting auth token...");
    const { token } = await api("/token", {
      method: "POST",
      body: { address, password },
    });

    // Store credentials on the page object so polling methods can access them
    page._mailtmToken = token;
    page._mailtmAddress = address;

    logger.info(`[MailTm] Email ready: ${address}`);
    return address;
  },

  // Polls the Mail.tm inbox until an email with a numeric verification code arrives.
  async waitForVerificationCodeEmail(
    page,
    { seenIds = new Set(), codeRe = /\b(\d{6})\b/, timeout = 120_000 } = {},
  ) {
    const token = page._mailtmToken;
    if (!token)
      throw new Error("[MailTm] No auth token — call createEmail first.");

    logger.info("[MailTm] Polling inbox for verification code...");

    const reader = buildReader(token);

    const result = await pollApi(
      reader,
      { seenIds, timeout },
      async (content, preview) => {
        const fromPreview = codeRe.exec(preview)?.[1];
        if (fromPreview) {
          logger.info(`[MailTm] Code found in preview: ${fromPreview}`);
          return fromPreview;
        }

        const fromBody = codeRe.exec(content)?.[1];
        if (fromBody) {
          logger.info(`[MailTm] Code found in body: ${fromBody}`);
          return fromBody;
        }

        logger.info("[MailTm] No code in this email — skipping.");
        return null;
      },
    );

    if (!result)
      logger.warn("[MailTm] Timed out waiting for verification code email.");
    return result;
  },

  // Polls the Mail.tm inbox until an email matching filterText arrives,
  // then extracts and returns the first URL matching pattern (or any URL).
  async waitForEmailAndExtractLink(
    page,
    {
      filterText = "",
      pattern = null,
      seenIds = new Set(),
      timeout = 120_000,
    } = {},
  ) {
    const token = page._mailtmToken;
    if (!token)
      throw new Error("[MailTm] No auth token — call createEmail first.");

    logger.info(
      `[MailTm] Waiting for validation link email${filterText ? ` matching "${filterText}"` : ""}...`,
    );

    const reader = buildReader(token);

    const result = await pollApi(
      reader,
      { filterText, seenIds, timeout },
      async (content, preview) => {
        const links = extractLinks(content);
        const match = pattern
          ? links.find((l) => pattern.test(l))
          : (links[0] ?? null);

        if (match) {
          logger.info(`[MailTm] Extracted link: ${match}`);
        } else {
          logger.warn(
            `[MailTm] No usable link found in email (preview: "${preview.slice(0, 80)}") — skipping.`,
          );
        }
        return match ?? null;
      },
    );

    if (!result)
      logger.warn(
        `[MailTm] Timed out waiting for email${filterText ? ` matching "${filterText}"` : ""}.`,
      );

    return result;
  },

  // Polls the Mail.tm inbox until an email with M3U links arrives,
  // then extracts and returns playlist URLs + duration info.
  async waitForEmailAndExtractPlaylists(
    page,
    { filterText = "", seenIds = new Set(), timeout = 120_000 } = {},
  ) {
    const token = page._mailtmToken;
    if (!token)
      throw new Error("[MailTm] No auth token — call createEmail first.");

    logger.info(
      `[MailTm] Polling inbox for playlist email${filterText ? ` matching "${filterText}"` : ""}...`,
    );

    const reader = buildReader(token);

    const result = await pollApi(
      reader,
      { filterText, seenIds, timeout },
      async (content) => {
        const playlists = extractPlaylists(content);

        if (!playlists) {
          logger.info("[MailTm] No M3U links in this email — skipping.");
          return null;
        }

        logger.info(
          `[MailTm] TV: ${playlists.tvPlaylist}, VOD: ${playlists.vodPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
        );
        if (playlists.duration)
          logger.info(
            `[MailTm] Duration: ${playlists.duration}${playlists.expiresAt ? ` · expires: ${playlists.expiresAt}` : ""}`,
          );

        return playlists;
      },
    );

    if (!result) logger.warn("[MailTm] Timed out waiting for playlist email.");

    return result ?? EMPTY_PLAYLISTS;
  },
};
