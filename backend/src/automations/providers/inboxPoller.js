/**
 * Shared inbox poller — opens unseen emails and extracts what the caller needs.
 *
 * Exports:
 *   waitForValidationLink(page, opts)        – extracts an account validation link
 *   waitForPlaylistEmail(page, opts)         – extracts M3U playlist URLs
 *   waitForVerificationCodeEmail(page, opts) – extracts a numeric verification code
 */

import logger from "../../logger.js";

// ─── Selectors ────────────────────────────────────────────────────────────────
// Update these when switching temp-mail providers.

export const INBOX_SELECTORS = {
  messageRow: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    // Each inbox row is a <button aria-label="View {subject}"> rendered
    // client-side inside section[aria-labelledby="inbox-heading"].
    'section[aria-labelledby="inbox-heading"] button[aria-label^="View "]',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    // Rows carry no consistent data-* attribute so we match by container + class.
    "#email-list .email-item",
    "#email-list > div:not(.empty-state)",
    ".email-list .email-item",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    "#inbox .message",
    ".inbox-item",
    ".mail-item",
    ".message-item",
    "[data-id]",
    "[data-email-id]",
    "[data-message-id]",
    '[class*="email-item"]',
    '[class*="inbox-item"]',
  ].join(", "),

  refreshBtn: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    // Sits next to <h2 id="inbox-heading"> — targeted by position, not text.
    "#inbox-heading + button",

    // ── tmaily.com ────────────────────────────────────────────────────────────
    "#refresh-btn",
    ".refresh-btn",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    "[data-refresh]",
    '[aria-label*="refresh" i]',
    'button:has-text("Refresh")',
  ].join(", "),

  backToInbox: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    // Opening a message flips a card in-place — close button carries this label.
    'button[aria-label="Close message detail"]',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    'a:has-text("Back to Inbox")',
    "#back-to-inbox",
    ".back-to-inbox",

    // ── Generic fallbacks ─────────────────────────────────────────────────────
    'button:has-text("Back")',
    'a:has-text("Back")',
    'button:has-text("Inbox")',
    ".back",
    'a[href="/"]',
    '[aria-label*="back" i]',
  ].join(", "),
};

// ─── Duration units ───────────────────────────────────────────────────────────

const DURATION_UNITS = [
  { pattern: /дней|день|дня|days?/i, label: "Days", ms: 864e5 },
  { pattern: /месяцев|месяца|месяц|months?/i, label: "Months", ms: 2592e6 },
  { pattern: /часов|часа|час|hours?/i, label: "Hours", ms: 36e5 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findVisible(page, selector) {
  for (const sel of selector.split(", ")) {
    try {
      const el = await page.$(sel.trim());
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Clicks a row, reads content across all frames, then navigates back to inbox
async function openAndRead(page, row) {
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});
  await page.waitForTimeout(1_200);

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
    await page
      .goBack({ waitUntil: "domcontentloaded", timeout: 10_000 })
      .catch(() => {});
  await page.waitForTimeout(600);

  return body;
}

// Collects all URLs from href attributes and bare links in the email content
function extractLinks(content) {
  const hrefs = [...content.matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
  const bare = [...content.matchAll(/https?:\/\/[^\s"'<>\]]+/gi)].map(
    (m) => m[0],
  );
  return [...new Set([...hrefs, ...bare])];
}

// Parses a duration string and computes an expiry timestamp
function extractDuration(content) {
  const m = content.match(
    /(\d+)\s*(дней|день|дня|месяцев|месяца|месяц|часов|часа|час|days?|months?|hours?)/i,
  );
  if (!m) return { duration: null, expiresAt: null };
  const n = parseInt(m[1], 10);
  const unit = DURATION_UNITS.find((u) => u.pattern.test(m[2]));
  return {
    duration: unit
      ? `${n} ${n === 1 ? unit.label.slice(0, -1) : unit.label}`
      : `${n} ${m[2]}`,
    expiresAt: unit
      ? new Date(Date.now() + n * unit.ms).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : null,
  };
}

// ─── Core poll loop ───────────────────────────────────────────────────────────
// Refreshes the inbox and calls onRow(rowText, row) for every unseen message.
// Returns the first non-null value from onRow, or null on timeout.
//
// seenIds is mutated here — every encountered email ID is added to it.
// Passing the same Set across services ensures an already-opened email is
// never re-processed, regardless of how many services have run before.
//
// Row ID priority: data-id → data-email-id → data-message-id → first 80 chars of text

async function poll(
  page,
  { filterText = "", seenIds = new Set(), timeout = 120_000 },
  onRow,
) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const btn = await findVisible(page, INBOX_SELECTORS.refreshBtn);
    await (btn ? btn.click().catch(() => {}) : page.waitForTimeout(1_500));
    await page.waitForTimeout(800);

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

  const result = await poll(
    page,
    { filterText, seenIds, timeout },
    async (_rowText, row) => {
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

  const empty = {
    tvPlaylist: null,
    vodPlaylist: null,
    allM3uLinks: [],
    duration: null,
    expiresAt: null,
  };
  const result = await poll(
    page,
    { filterText, seenIds, timeout },
    async (_rowText, row) => {
      const body = await openAndRead(page, row);
      const unique = [
        ...new Set(
          [
            // Plain .m3u / .m3u8 file links (with optional query string)
            ...body.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8?[^\s"'<>]*/gi),
            // ?type=m3u* / &type=m3u* — covers m3u, m3u8, m3u_plus, etc.
            // Handles: ?type=m3u_plus&output=ts
            ...body.matchAll(/https?:\/\/[^\s"'<>]*[?&]type=m3u[^\s"'<>]*/gi),
            // Strip trailing HTML entities (e.g. &lt;/div&gt;) without breaking
            // query-string ampersands like &username=x&password=y&type=m3u_plus
          ].map((m) => m[0].replace(/&(?:lt|gt|amp|quot|apos);.*/i, "")),
        ),
      ];

      if (!unique.length) {
        logger.info("[InboxPoller] No M3U links in this email — skipping.");
        return null;
      }

      const tv =
        unique.find((u) => /type=m3u|\/tv\.|\/playlist|live/i.test(u)) ??
        unique[0];
      const vod =
        unique.find((u) => /\/vod\.|type=m3u8/i.test(u) && u !== tv) ??
        unique[1] ??
        null;
      const { duration, expiresAt } = extractDuration(body);

      logger.info(
        `[InboxPoller] TV: ${tv}, VOD: ${vod ?? "none"}, total: ${unique.length}`,
      );
      if (duration)
        logger.info(
          `[InboxPoller] Duration: ${duration}${expiresAt ? ` · expires: ${expiresAt}` : ""}`,
        );
      return {
        tvPlaylist: tv,
        vodPlaylist: vod,
        allM3uLinks: unique,
        duration,
        expiresAt,
      };
    },
  );

  if (!result)
    logger.warn("[InboxPoller] Timed out waiting for playlist email.");
  return result ?? empty;
}

export async function waitForVerificationCodeEmail(
  page,
  {
    seenIds = new Set(),
    codeRe = /(?:code[:\s#-]*|your\s+(?:verification\s+)?code\s+(?:is\s+)?)?(\d{4,8})(?!\d)/i,
    timeout = 120_000,
  } = {},
) {
  logger.info("[InboxPoller] Polling inbox for verification code...");

  return poll(page, { seenIds, timeout }, async (rowText, row) => {
    // Check row preview first — avoids opening the email unnecessarily
    const fromPreview = codeRe.exec(rowText);
    if (fromPreview?.[1]) {
      logger.info(`[InboxPoller] Code found in preview: ${fromPreview[1]}`);
      return fromPreview[1];
    }

    const fromBody = codeRe.exec(await openAndRead(page, row));
    if (fromBody?.[1]) {
      logger.info(`[InboxPoller] Code found in body: ${fromBody[1]}`);
      return fromBody[1];
    }

    logger.info("[InboxPoller] No code in this email — skipping.");
    return null;
  });
}
