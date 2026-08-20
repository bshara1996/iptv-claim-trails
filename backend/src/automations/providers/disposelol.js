import logger from "../../logger.js";
import { waitForValidationLink, waitForPlaylistEmail } from "./inboxPoller.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://dispose.lol/",

  selectors: {
    // The generated address lives in a <p> inside this aria-live container.
    // The same container shows "Loading" while the address is being generated.
    addressContainer: '[aria-live="polite"] p',

    // Sentinel text visible while the address is still loading
    loadingText: "Loading",
  },

  timeouts: {
    pageLoad: 20_000,
    addressPoll: 15_000,
    pollInterval: 800,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidEmail(str) {
  return (
    typeof str === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str.trim())
  );
}

async function readEmailFromPage(page) {
  try {
    const el = await page.$(CONFIG.selectors.addressContainer);
    if (!el) return null;
    const text = (await el.innerText().catch(() => "")).trim();
    if (
      isValidEmail(text) &&
      !text.toLowerCase().startsWith(CONFIG.selectors.loadingText.toLowerCase())
    )
      return text;
  } catch (_) {}

  // Fallback: regex scan of body text
  try {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const m = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m && isValidEmail(m[0])) return m[0];
  } catch (_) {}

  return null;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const DisposeLolProvider = {
  meta: {
    id: "disposelol",
    name: "Dispose.lol",
    url: CONFIG.url,
    description: "Disposable temporary email via dispose.lol",
  },

  async createEmail(page) {
    logger.info("[DisposeLol] Navigating to dispose.lol...");
    await page.goto(CONFIG.url, {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.timeouts.pageLoad,
    });

    // Wait for the address container to appear and show a non-loading value
    logger.info("[DisposeLol] Waiting for email address to be generated...");
    await page
      .waitForFunction(
        (sel, loadingText) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const t = el.innerText?.trim() ?? "";
          return t.length > 0 && !t.toLowerCase().startsWith(loadingText);
        },
        CONFIG.selectors.addressContainer,
        CONFIG.selectors.loadingText.toLowerCase(),
        { timeout: CONFIG.timeouts.addressPoll },
      )
      .catch(() => {});

    const deadline = Date.now() + CONFIG.timeouts.addressPoll;
    while (Date.now() < deadline) {
      const email = await readEmailFromPage(page);
      if (email) {
        logger.info(`[DisposeLol] Email ready: ${email}`);
        return email;
      }
      await page.waitForTimeout(CONFIG.timeouts.pollInterval);
    }
    throw new Error("[DisposeLol] Timed out waiting for email address.");
  },

  // Delegates to inboxPoller — the INBOX_SELECTORS in inboxPoller.js include
  // dispose.lol-specific selectors for message rows, refresh, and back buttons.
  waitForEmailAndExtractLink: waitForValidationLink,
  waitForEmailAndExtractPlaylists: waitForPlaylistEmail,
};

export default DisposeLolProvider;
