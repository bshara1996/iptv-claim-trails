import logger from "../../logger.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://tmaily.com/",

  selectors: {
    emailCandidates: [
      "#email-address",
      "#email",
      "#temp-email",
      "#mailbox",
      ".email-address",
      ".temp-email",
      ".mailbox-address",
      ".address",
      ".email",
      "input[readonly]",
      'input[type="email"][readonly]',
      "[data-email]",
      "[data-address]",
      '[class*="email"]',
      '[class*="address"]',
      '[id*="email"]',
    ],

    generatingMarker: ':text("generating")',

    messageRow: [
      "#email-list .email-item",
      "#email-list > div:not(.empty-state)",
      "#inbox .message",
      ".email-list .email-item",
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
      "#refresh-btn",
      ".refresh-btn",
      "[data-refresh]",
      '[aria-label*="refresh" i]',
      'button:has-text("Refresh")',
    ].join(", "),

    emailBody: [
      "#email-body",
      "#message-body",
      ".email-body",
      ".message-body",
      ".email-content",
      ".mail-viewer",
      "iframe",
    ].join(", "),

    backToInbox: [
      'button:has-text("Back")',
      'a:has-text("Back")',
      'button:has-text("Inbox")',
      'a:has-text("Back to Inbox")',
      "#back-to-inbox",
      ".back-to-inbox",
      ".back",
      'a[href="/"]',
      '[aria-label*="back" i]',
    ],
  },

  timeouts: {
    pageLoad: 20_000,
    emailWait: 120_000,
    pollInterval: 800,
    messageSettle: 1_200,
  },
};

// ─── Duration units ───────────────────────────────────────────────────────────

const DURATION_UNITS = [
  { pattern: /дней|день|дня|days?/i, label: "Days", ms: 864e5 },
  { pattern: /месяцев|месяца|месяц|months?/i, label: "Months", ms: 2592e6 },
  { pattern: /часов|часа|час|hours?/i, label: "Hours", ms: 36e5 },
];

// ─── Page helpers ─────────────────────────────────────────────────────────────

function isValidEmail(str) {
  return (
    typeof str === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim())
  );
}

async function readEmailFromPage(page) {
  for (const sel of CONFIG.selectors.emailCandidates) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const text = (
        (await el.innerText().catch(() => "")) ||
        (await el.inputValue().catch(() => "")) ||
        (await el.getAttribute("data-email").catch(() => ""))
      ).trim();
      if (isValidEmail(text)) return text;
    } catch (_) {}
  }
  try {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const m = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m && isValidEmail(m[0])) return m[0];
  } catch (_) {}
  return null;
}

async function refreshInbox(page) {
  await page.bringToFront().catch(() => {});
  for (const sel of CONFIG.selectors.refreshBtn.split(", ")) {
    try {
      const btn = await page.$(sel.trim());
      if (btn && (await btn.isVisible().catch(() => false))) {
        await btn.click().catch(() => {});
        break;
      }
    } catch (_) {}
  }
}

async function openMessageRow(page, row) {
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});
  await page
    .waitForSelector(CONFIG.selectors.emailBody.split(", ")[0], {
      timeout: CONFIG.timeouts.messageSettle,
    })
    .catch(() => page.waitForTimeout(CONFIG.timeouts.messageSettle));
}

async function extractEmailBodyContent(page) {
  let content = "";
  for (const sel of CONFIG.selectors.emailBody.split(", ")) {
    try {
      const el = await page.$(sel.trim());
      if (!el) continue;
      const tag = await el
        .evaluate((n) => n.tagName?.toLowerCase())
        .catch(() => "");
      if (tag === "iframe") {
        const frame = await el.contentFrame().catch(() => null);
        if (frame) {
          content += await frame
            .evaluate(() => document.body?.innerHTML ?? "")
            .catch(() => "");
          content +=
            "\n" +
            (await frame
              .evaluate(() => document.body?.innerText ?? "")
              .catch(() => ""));
        }
      } else {
        content += await el.innerHTML().catch(() => "");
        content += "\n" + (await el.innerText().catch(() => ""));
      }
    } catch (_) {}
  }
  content +=
    "\n" +
    (await page.evaluate(() => document.body?.innerHTML ?? "").catch(() => ""));
  return content;
}

async function goBackToInbox(page) {
  for (const sel of CONFIG.selectors.backToInbox) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        await el.click();
        await page.waitForTimeout(600);
        return;
      }
    } catch (_) {}
  }
  await page
    .reload({
      waitUntil: "domcontentloaded",
      timeout: CONFIG.timeouts.pageLoad,
    })
    .catch(() => {});
  await page.waitForTimeout(800);
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

function extractPlaylists(content) {
  const byExt = [
    ...content.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8?[^\s"'<>]*/gi),
  ].map((m) => m[0]);
  const byQS = [
    ...content.matchAll(/https?:\/\/[^\s"'<>]*[?&]type=m3u8?[^\s"'<>]*/gi),
  ].map((m) => m[0]);
  const unique = [...new Set([...byExt, ...byQS])];
  const tv =
    unique.find((u) => /type=m3u|\/tv\.|\/playlist|live/i.test(u)) ??
    unique[0] ??
    null;
  const vod =
    unique.find((u) => /\/vod\.|type=m3u8/i.test(u)) ??
    (unique.length > 1 && unique[1] !== tv ? unique[1] : null);
  return { tvPlaylist: tv, vodPlaylist: vod, allM3uLinks: unique };
}

function extractDuration(content) {
  const m = content.match(
    /(\d+)\s*(дней|день|дня|месяцев|месяца|месяц|часов|часа|час|days?|months?|hours?)/i,
  );
  if (!m) return { duration: null, expiresAt: null };
  const n = parseInt(m[1], 10);
  const unit = DURATION_UNITS.find((u) => u.pattern.test(m[2]));
  const duration = unit
    ? `${n} ${n === 1 ? unit.label.slice(0, -1) : unit.label}`
    : `${n} ${m[2]}`;
  const expiresAt = unit
    ? new Date(Date.now() + n * unit.ms).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : null;
  return { duration, expiresAt };
}

// ─── Shared poll loop ─────────────────────────────────────────────────────────

async function pollInbox(emailPage, filterText, timeout, onMatch) {
  const deadline = Date.now() + timeout;
  let lastRowCount = 0;

  while (Date.now() < deadline) {
    await refreshInbox(emailPage);
    await emailPage.waitForTimeout(CONFIG.timeouts.pollInterval);

    const rows = await emailPage
      .$$(CONFIG.selectors.messageRow)
      .catch(() => []);
    if (rows.length !== lastRowCount) {
      logger.info(`[Tmaily] Inbox: ${rows.length} message(s).`);
      lastRowCount = rows.length;
    }

    for (const row of rows) {
      const text = await row.innerText().catch(() => "");
      if (filterText && !text.toLowerCase().includes(filterText.toLowerCase()))
        continue;

      await openMessageRow(emailPage, row);
      const content = await extractEmailBodyContent(emailPage);
      const result = await onMatch(content);

      await goBackToInbox(emailPage);
      if (result !== null) return result;

      logger.warn(
        "[Tmaily] Email opened but no usable content found. Returning to inbox...",
      );
    }
  }
  return null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const TmailyProvider = {
  meta: {
    id: "tmaily",
    name: "TMaily",
    url: CONFIG.url,
    description: "Disposable temporary email via tmaily.com",
  },

  async createEmail(page) {
    logger.info("[Tmaily] Navigating to tmaily.com...");
    await page.goto(CONFIG.url, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.timeouts.pageLoad,
    });

    logger.info("[Tmaily] Waiting for email address to be generated...");
    await page
      .waitForSelector(CONFIG.selectors.generatingMarker, {
        state: "hidden",
        timeout: 10_000,
      })
      .catch(() =>
        logger.info(
          "[Tmaily] Generating marker gone / not found — proceeding.",
        ),
      );

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const email = await readEmailFromPage(page);
      if (email) {
        logger.info(`[Tmaily] Email ready: ${email}`);
        return email;
      }
      await page.waitForTimeout(CONFIG.timeouts.pollInterval);
    }
    throw new Error("[Tmaily] Timed out waiting for email address.");
  },

  async waitForEmailAndExtractLink(
    emailPage,
    {
      filterText = "",
      pattern = null,
      timeout = CONFIG.timeouts.emailWait,
    } = {},
  ) {
    logger.info(`[Tmaily] Waiting for email matching "${filterText}"...`);
    const result = await pollInbox(
      emailPage,
      filterText,
      timeout,
      (content) => {
        const links = extractLinks(content);
        const match = pattern
          ? links.find((l) => pattern.test(l))
          : (links[0] ?? null);
        if (match) logger.info(`[Tmaily] Extracted link: ${match}`);
        return match ?? null;
      },
    );
    if (!result)
      logger.warn(`[Tmaily] Timed out waiting for email from "${filterText}".`);
    return result;
  },

  async waitForEmailAndExtractPlaylists(
    emailPage,
    { filterText = "", timeout = CONFIG.timeouts.emailWait } = {},
  ) {
    logger.info(
      `[Tmaily] Waiting for playlist email matching "${filterText}"...`,
    );
    const result = await pollInbox(
      emailPage,
      filterText,
      timeout,
      (content) => {
        const playlists = extractPlaylists(content);
        const { duration, expiresAt } = extractDuration(content);
        logger.info(
          `[Tmaily] TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
        );
        if (duration)
          logger.info(
            `[Tmaily] Duration: ${duration}${expiresAt ? ` · expires: ${expiresAt}` : ""}`,
          );
        return { ...playlists, duration, expiresAt };
      },
    );
    if (!result) {
      logger.warn(
        `[Tmaily] Timed out waiting for playlist email from "${filterText}".`,
      );
      return {
        tvPlaylist: null,
        vodPlaylist: null,
        allM3uLinks: [],
        duration: null,
        expiresAt: null,
      };
    }
    return result;
  },
};

export default TmailyProvider;
