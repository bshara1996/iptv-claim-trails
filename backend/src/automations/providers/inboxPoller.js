import logger from "../../logger.js";

// ─── Selectors ────────────────────────────────────────────────────────────────
// Update these when switching temp-mail providers.

export const INBOX_SELECTORS = {
  messageRow: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    // Each inbox row is a <button aria-label="View {subject}"> rendered
    // client-side inside section[aria-labelledby="inbox-heading"].
    // The selector below matches every such row regardless of subject text.
    'section[aria-labelledby="inbox-heading"] button[aria-label^="View "]',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    // tmaily renders its inbox as a list of divs/items inside #email-list.
    // Rows carry no consistent data-* attribute so we match by container + class.
    "#email-list .email-item",
    "#email-list > div:not(.empty-state)",
    ".email-list .email-item",

    // ── Generic / other providers ─────────────────────────────────────────────
    // Broad fallback selectors that cover common inbox layouts across providers
    // that were not explicitly mapped above.
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
    // The refresh button sits next to <h2 id="inbox-heading"> as an immediate
    // sibling. Its visible text is "Refresh" (or "Read-only" when the mailbox
    // is locked), so we target it by position rather than text.
    "#inbox-heading + button",

    // ── tmaily.com ────────────────────────────────────────────────────────────
    // tmaily exposes a dedicated refresh button with a stable id and class.
    "#refresh-btn",
    ".refresh-btn",

    // ── Generic / other providers ─────────────────────────────────────────────
    "[data-refresh]",
    '[aria-label*="refresh" i]',
    'button:has-text("Refresh")',
  ].join(", "),

  backToInbox: [
    // ── dispose.lol ──────────────────────────────────────────────────────────
    // Opening a message flips a card in-place — no page navigation occurs.
    // The close button inside the message detail panel carries this aria-label.
    'button[aria-label="Close message detail"]',

    // ── tmaily.com ────────────────────────────────────────────────────────────
    // tmaily renders a standard "Back to Inbox" anchor after opening a message.
    'a:has-text("Back to Inbox")',
    "#back-to-inbox",
    ".back-to-inbox",

    // ── Generic / other providers ─────────────────────────────────────────────
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

// Returns the first visible element matching any selector in the comma-separated string.
async function findVisible(page, selector) {
  for (const sel of selector.split(", ")) {
    try {
      const el = await page.$(sel.trim());
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Opens a row, reads text from all frames (including iframes), then navigates back.
async function openAndRead(page, row) {
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});

  // dispose.lol opens an in-place panel — wait for its close button to appear
  // so the content is fully rendered before we read it. For providers that do
  // a real page navigation the selector won't match and we fall back to a
  // generous fixed delay.
  const panelReady = await page
    .waitForSelector('button[aria-label="Close message detail"]', {
      state: "visible",
      timeout: 5_000,
    })
    .catch(() => null);
  if (!panelReady) await page.waitForTimeout(2_500);

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
  if (back) {
    await back.click();
    await page.waitForTimeout(600);
  } else {
    await page
      .goBack({ waitUntil: "domcontentloaded", timeout: 10_000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  }

  return body;
}

// ─── Content parsers ──────────────────────────────────────────────────────────

function extractLinks(content) {
  const hrefs = [...content.matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
  const bare = [...content.matchAll(/https?:\/\/[^\s"'<>\]]+/gi)].map(
    (m) => m[0],
  );
  return [...new Set([...hrefs, ...bare])];
}

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
// Refreshes the inbox on each iteration and calls onRow(rowText, row) for every
// unseen message. Returns the first non-null value returned by onRow.
//
// seenIds is the deduplication key. It is passed in by the caller and mutated
// here — every email ID encountered is added to it. Passing the same Set across
// multiple poll() calls (or across multiple services sharing one inbox) means
// an email that was already opened will never be opened again, regardless of
// how many services have run before this one.
//
// The ID for each row is resolved in this priority order:
//   1. data-id attribute   — present on most temp-mail providers
//   2. data-email-id       — alternative attribute used by some providers
//   3. data-message-id     — another common alternative
//   4. first 80 chars of the row's visible text — provider-agnostic fallback
// This makes the deduplication logic work with any temp-mail provider without
// requiring provider-specific code here.

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

  const result = await poll(
    page,
    { filterText, seenIds, timeout },
    async (_rowText, row) => {
      const body = await openAndRead(page, row);
      const unique = [
        ...new Set(
          [
            ...body.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8?[^\s"'<>]*/gi),
            ...body.matchAll(/https?:\/\/[^\s"'<>]*[?&]type=m3u8?[^\s"'<>]*/gi),
          ].map((m) => m[0]),
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

  if (!result) {
    logger.warn("[InboxPoller] Timed out waiting for playlist email.");
    return {
      tvPlaylist: null,
      vodPlaylist: null,
      allM3uLinks: [],
      duration: null,
      expiresAt: null,
    };
  }
  return result;
}

// Extracts the most likely OTP from a text string.
// Strategy:
//   1. Prefer a digit run that is explicitly preceded by code-context keywords.
//   2. Fall back to the shortest standalone digit run (4–8 digits) that is NOT
//      surrounded by other digits — avoids matching years, phone numbers, etc.
function extractCode(text) {
  // Primary: digit run with an explicit code-context prefix.
  const withContext = [
    ...text.matchAll(
      /(?:code|otp|pin|verification|confirm)[^a-z0-9]*?(\d{4,8})(?!\d)/gi,
    ),
  ];
  if (withContext.length) {
    // If multiple matches, prefer the shortest (OTPs are usually 4–6 digits).
    return withContext.reduce((best, m) =>
      m[1].length < best[1].length ? m : best,
    )[1];
  }

  // Fallback: any standalone 4–8 digit sequence not adjacent to more digits.
  const standalone = [...text.matchAll(/(?<!\d)(\d{4,8})(?!\d)/g)];
  if (!standalone.length) return null;
  // Prefer shorter sequences (OTPs) over longer ones (e.g. phone numbers).
  return standalone.reduce((best, m) =>
    m[1].length < best[1].length ? m : best,
  )[1];
}

export async function waitForVerificationCodeEmail(
  page,
  { filterText = "", seenIds = new Set(), timeout = 120_000 } = {},
) {
  logger.info("[InboxPoller] Polling inbox for verification code...");

  return poll(page, { filterText, seenIds, timeout }, async (rowText, row) => {
    // Check the row preview first — avoids opening the email unnecessarily.
    const fromPreview = extractCode(rowText);
    if (fromPreview) {
      logger.info(`[InboxPoller] Code found in preview: ${fromPreview}`);
      return fromPreview;
    }

    const fromBody = extractCode(await openAndRead(page, row));
    if (fromBody) {
      logger.info(`[InboxPoller] Code found in body: ${fromBody}`);
      return fromBody;
    }

    logger.info("[InboxPoller] No code in this email — skipping.");
    return null;
  });
}
