/**
 * TMaily disposable email provider.
 *
 * Opens tmaily.com, waits for a temporary email address to be generated,
 * then exposes inbox polling via the shared inboxPoller helpers.
 * Swapping providers only requires updating the import in registry.js.
 */
import logger from "../../logger.js";
import { waitForValidationLink, waitForPlaylistEmail } from "./inboxPoller.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://tmaily.com/",

  selectors: {
    // Ordered from most specific to most generic — first match wins
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

    // Visible while the page is still generating the address
    generatingMarker: ':text("generating")',
  },

  timeouts: {
    pageLoad: 20_000,
    pollInterval: 800,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Basic email format check to filter out false positives from broad selectors
function isValidEmail(str) {
  return (
    typeof str === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim())
  );
}

// Tries each candidate selector in order, reading the value as text, input value,
// or data-email attribute. Falls back to a regex scan of the full page body.
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
  // Last resort — scan the entire page body for an email-shaped string
  try {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const m = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m && isValidEmail(m[0])) return m[0];
  } catch (_) {}
  return null;
}

// ── Provider ──────────────────────────────────────────────────────────────────

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

    // Wait for the "generating" indicator to disappear before reading the address
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

    // Poll until the address is readable — the DOM may update slightly after the marker hides
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

  // Delegates inbox polling to inboxPoller — no provider-specific logic needed
  waitForEmailAndExtractLink: waitForValidationLink,
  waitForEmailAndExtractPlaylists: waitForPlaylistEmail,
};

export default TmailyProvider;
