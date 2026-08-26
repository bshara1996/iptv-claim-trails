/**
 * base/browserProvider.js
 *
 * Shared infrastructure for Playwright-based email providers.
 *
 * Exports:
 *   readEmailFromBody(page)   — last-resort body scan for an email-shaped string
 *   createBrowserProvider(meta, readEmailFromPage, timeouts?, beforePoll?)
 *                             — returns a complete provider object for any browser provider
 */

import logger from "../../../logger.js";
import {
  waitForValidationLink,
  waitForPlaylistEmail,
  waitForVerificationCodeEmail,
} from "../../inbox/index.js";

// ── readEmailFromBody ─────────────────────────────────────────────────────────

// Scans the full page body text for the first email-shaped string.
// Used as a last resort when all targeted selectors fail.
export async function readEmailFromBody(page) {
  try {
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const m = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (m) return m[0];
  } catch (_) {}
  return null;
}

// ── createBrowserProvider ─────────────────────────────────────────────────────

const BROWSER_DEFAULTS = {
  pageLoad: 20_000,
  addressPoll: 15_000,
  pollInterval: 800,
};

// Builds a complete browser-based provider object from a meta descriptor and a DOM reader.
// Handles navigation, the address poll loop, and wires the three shared waitFor* methods.
export function createBrowserProvider(
  meta,
  readEmailFromPage,
  timeouts = {},
  beforePoll = null,
) {
  const tag = meta.name;
  const t = { ...BROWSER_DEFAULTS, ...timeouts };

  return {
    meta,

    // Navigates to the provider page and polls until a temporary email address appears.
    async createEmail(page) {
      logger.info(`[${tag}] Navigating to ${meta.url}...`);
      await page.goto(meta.url, {
        waitUntil: "domcontentloaded",
        timeout: t.pageLoad,
      });

      logger.info(`[${tag}] Waiting for email address to be generated...`);

      // Run provider-specific pre-poll hook (e.g. wait for a loading indicator to disappear).
      if (beforePoll) await beforePoll(page).catch(() => {});

      const deadline = Date.now() + t.addressPoll;
      while (Date.now() < deadline) {
        const email = await readEmailFromPage(page);
        if (email) {
          logger.info(`[${tag}] Email ready: ${email}`);
          return email;
        }
        await page.waitForTimeout(t.pollInterval);
      }
      throw new Error(`[${tag}] Timed out waiting for email address.`);
    },

    // Delegate inbox polling directly to the shared browser pollers.
    waitForEmailAndExtractLink: waitForValidationLink,
    waitForEmailAndExtractPlaylists: waitForPlaylistEmail,
    waitForVerificationCodeEmail,
  };
}
