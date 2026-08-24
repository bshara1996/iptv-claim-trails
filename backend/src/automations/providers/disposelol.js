/**
 * Dispose.lol disposable email provider.
 *
 * Opens dispose.lol, waits for a temporary email address to be generated,
 * then exposes inbox polling via the shared inboxPoller helpers.
 * Swapping providers only requires updating the import in registry.js.
 */
import logger from "../../logger.js";
import {
  waitForValidationLink,
  waitForPlaylistEmail,
  waitForVerificationCodeEmail,
} from "../inbox/index.js";
import { readEmailFromBody } from "./pageHelpers.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  url: "https://dispose.lol/",

  selectors: {
    // The generated address lives in a <p> inside this aria-live container.
    // The same container shows "Loading" while the address is still being generated.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Reads the address from the aria-live container, falling back to a body scan
async function readEmailFromPage(page) {
  try {
    const el = await page.$(CONFIG.selectors.addressContainer);
    if (!el) return null;
    const text = (await el.innerText().catch(() => "")).trim();
    if (
      text &&
      !text.toLowerCase().startsWith(CONFIG.selectors.loadingText.toLowerCase())
    )
      return text;
  } catch (_) {}

  return readEmailFromBody(page);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
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

    // Wait for the container to show a non-loading value before polling
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

    // Poll until the address is readable — DOM may still settle after waitForFunction resolves
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

  // Delegates inbox polling to the shared poller — no provider-specific logic needed
  waitForEmailAndExtractLink: waitForValidationLink,
  waitForEmailAndExtractPlaylists: waitForPlaylistEmail,
  waitForVerificationCodeEmail,
};
