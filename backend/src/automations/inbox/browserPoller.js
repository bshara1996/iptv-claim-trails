/**
 * Browser-based inbox poller.
 *
 * Drives a Playwright page to refresh the inbox, open each unseen email,
 * and extract whatever the caller needs via the onRow callback.
 *
 * Exports:
 *   waitForValidationLink(page, opts)        – extracts an account validation link
 *   waitForPlaylistEmail(page, opts)         – extracts M3U playlist URLs
 *   waitForVerificationCodeEmail(page, opts) – extracts a numeric verification code
 */

import logger from "../../logger.js";
import { INBOX_SELECTORS } from "./selectors.js";
import {
  extractLinks,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "./extractors.js";
import { findVisible } from "../utils/pageUtils.js";

// Clicks a row, waits for the DOM to settle, reads content across all frames,
// then navigates back to the inbox.
async function openAndRead(page, row) {
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});
  await page.waitForLoadState("commit").catch(() => page.waitForTimeout(400));

  const body = (
    await Promise.all(
      page
        .frames()
        .map((f) =>
          f
            .evaluate(
              () => `${document.body?.innerText}\n${document.body?.innerHTML}`,
            )
            .catch(() => ""),
        ),
    )
  ).join("\n");

  const back = await findVisible(page, INBOX_SELECTORS.backToInbox);
  if (back) await back.click();
  else
    await page.goBack({ waitUntil: "commit", timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(200);

  return body;
}

// ─── Core poll loop (internal) ────────────────────────────────────────────────
// Refreshes the inbox and calls onRow(rowText, row) for every unseen message.
// Returns the first non-null value from onRow, or null on timeout.
//
// seenIds is mutated — every encountered email ID is added to it.
// Passing the same Set across services ensures an already-opened email is
// never re-processed, regardless of how many services have run before.
//
// Row ID priority: data-id → data-email-id → data-message-id → first 80 chars of text

async function _poll(
  page,
  { filterText = "", seenIds = new Set(), timeout = 120_000 },
  onRow,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const btn = await findVisible(page, INBOX_SELECTORS.refreshBtn);
    await (btn ? btn.click().catch(() => {}) : page.waitForTimeout(500));
    await page.waitForTimeout(300);

    const rows = await page.$$(INBOX_SELECTORS.messageRow).catch(() => []);
    logger.info(`[InboxPoller] Inbox: ${rows.length} message(s).`);

    for (const row of rows) {
      const id = await row
        .evaluate(
          (el) =>
            el.dataset.id ??
            el.dataset.emailId ??
            el.dataset.messageId ??
            el.innerText.trim().slice(0, 80),
        )
        .catch(() => "");
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const rowText = await row.innerText().catch(() => "");
      if (
        filterText &&
        !rowText.toLowerCase().includes(filterText.toLowerCase())
      )
        continue;

      const result = await onRow(rowText, row);
      if (result != null) return result;
    }

    // Sleep between inbox refresh cycles
    await page.waitForTimeout(500).catch(() => {});
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function waitForValidationLink(
  page,
  {
    filterText = "",
    pattern = null,
    seenIds = new Set(),
    timeout = 120_000,
  } = {},
) {
  logger.info(
    `[InboxPoller] Waiting for validation link email matching "${filterText}"...`,
  );

  const result = await _poll(
    page,
    { filterText, seenIds, timeout },
    async (rowText, row) => {
      // Try the row preview text first — avoids opening the email if the link is visible there
      const fromPreview = extractLinks(rowText).find(
        (l) => !pattern || pattern.test(l),
      );
      if (fromPreview) {
        logger.info(
          `[InboxPoller] Extracted link from preview: ${fromPreview}`,
        );
        return fromPreview;
      }

      const links = extractLinks(await openAndRead(page, row));
      const match = pattern
        ? links.find((l) => pattern.test(l))
        : (links[0] ?? null);
      if (match) logger.info(`[InboxPoller] Extracted link: ${match}`);
      else
        logger.warn(
          "[InboxPoller] No usable link found in this email — skipping.",
        );
      return match ?? null;
    },
  );

  if (!result)
    logger.warn(
      `[InboxPoller] Timed out waiting for email from "${filterText}".`,
    );
  return result;
}

export async function waitForPlaylistEmail(
  page,
  { filterText = "", seenIds = new Set(), timeout = 120_000 } = {},
) {
  logger.info(
    `[InboxPoller] Polling inbox for playlist email${filterText ? ` matching "${filterText}"` : ""}...`,
  );

  const result = await _poll(
    page,
    { filterText, seenIds, timeout },
    async (_rowText, row) => {
      const body = await openAndRead(page, row);
      const playlists = extractPlaylists(body);

      if (!playlists) {
        logger.info("[InboxPoller] No M3U links in this email — skipping.");
        return null;
      }

      logger.info(
        `[InboxPoller] TV: ${playlists.tvPlaylist}, VOD: ${playlists.vodPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );
      if (playlists.duration)
        logger.info(
          `[InboxPoller] Duration: ${playlists.duration}${playlists.expiresAt ? ` · expires: ${playlists.expiresAt}` : ""}`,
        );

      return playlists;
    },
  );

  if (!result)
    logger.warn("[InboxPoller] Timed out waiting for playlist email.");
  return result ?? EMPTY_PLAYLISTS;
}

export async function waitForVerificationCodeEmail(
  page,
  {
    filterText = "",
    seenIds = new Set(),
    codeRe = /\b(\d{6})\b/,
    timeout = 120_000,
  } = {},
) {
  logger.info("[InboxPoller] Polling inbox for verification code...");

  return _poll(page, { filterText, seenIds, timeout }, async (rowText, row) => {
    const extract = (text) => codeRe.exec(text)?.[1] ?? null;

    const fromPreview = extract(rowText);
    if (fromPreview) {
      logger.info(`[InboxPoller] Code found in preview: ${fromPreview}`);
      return fromPreview;
    }

    const fromBody = extract(await openAndRead(page, row));
    if (fromBody) {
      logger.info(`[InboxPoller] Code found in body: ${fromBody}`);
      return fromBody;
    }

    logger.info("[InboxPoller] No code in this email — skipping.");
    return null;
  });
}
