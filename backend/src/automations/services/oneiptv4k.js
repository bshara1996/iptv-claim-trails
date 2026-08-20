/**
 * OneIPTV4K free trial registration service.
 *
 * Fills the registration form, waits for a verification code email, submits
 * the code on the site, then polls the inbox for the M3U playlist email.
 * No CAPTCHA — uses email-based verification instead.
 * Trial duration is 24 hours.
 */
import logger from "../../logger.js";
import {
  waitForVerificationCodeEmail,
  waitForPlaylistEmail,
} from "../providers/inboxPoller.js";
import { generateUsername, generatePhone } from "../utils/fakeData.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://oneiptv4k.com";
const TRIAL_PATH = "/free-trial";

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: [
    'input[name="name"]',
    'input[name="fullname"]',
    'input[name="username"]',
    'input[placeholder*="name" i]',
    'input[type="text"]:first-of-type',
  ],
  email: [
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="mail" i]',
  ],
  whatsapp: [
    'input[name="whatsapp"]',
    'input[name="phone"]',
    'input[name="mobile"]',
    'input[placeholder*="whatsapp" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="mobile" i]',
    'input[type="tel"]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Get Free Trial")',
    'button:has-text("Register")',
    'button:has-text("Send")',
    'button:has-text("Start")',
    'button:has-text("Claim")',
    'button:has-text("Continue")',
  ],
  codeInput: [
    'input[name="code"]',
    'input[name="otp"]',
    'input[name="verification"]',
    'input[name="verify"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="verif" i]',
    'input[placeholder*="otp" i]',
    'input[type="number"]',
    'input[maxlength="4"]',
    'input[maxlength="5"]',
    'input[maxlength="6"]',
    'input[maxlength="7"]',
    'input[maxlength="8"]',
  ],
  codeSubmit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Verify")',
    'button:has-text("Confirm")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the first visible element matching any selector, or null
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Fills the first visible field — falls back to simulated typing if fill() is rejected
async function fillFirst(page, selectors, value) {
  const el = await findVisible(page, selectors);
  if (!el) {
    logger.warn(`[OneIPTV4K] Field not found for selectors: ${selectors[0]}`);
    return;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.fill(value).catch(async () => {
    await el.click();
    await el.type(value, { delay: 40 });
  });
}

// Clicks the first visible element matching any selector
async function clickFirst(page, selectors) {
  const el = await findVisible(page, selectors);
  if (!el) {
    logger.warn(`[OneIPTV4K] Button not found for selectors: ${selectors[0]}`);
    return;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click();
}

// ── Service ───────────────────────────────────────────────────────────────────

const OneIptv4kRegistration = {
  meta: {
    id: "oneiptv4k",
    name: "OneIPTV4K",
    url: `${BASE_URL}${TRIAL_PATH}`,
    description:
      "OneIPTV4K 24-hour free trial — email code verification + M3U playlist",
  },

  async execute({
    page,
    emailPage,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const name = generateUsername();
    const whatsapp = generatePhone();

    // 1. Open registration page
    log(`[OneIPTV4K] Navigating to ${BASE_URL}${TRIAL_PATH}...`);
    await page
      .goto(`${BASE_URL}${TRIAL_PATH}`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })
      .catch(() =>
        logger.warn(
          "[OneIPTV4K] Page load timed out — proceeding with current DOM.",
        ),
      );

    // 2. Fill and submit the registration form
    log(
      `[OneIPTV4K] Filling form (name: "${name}", whatsapp: "${whatsapp}")...`,
    );
    await fillFirst(page, SELECTORS.name, name);
    await fillFirst(page, SELECTORS.email, email);
    await fillFirst(page, SELECTORS.whatsapp, whatsapp);
    await page.waitForTimeout(400);
    await clickFirst(page, SELECTORS.submit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    // 3. Poll inbox for the verification code
    log("[OneIPTV4K] Waiting for verification code email...");
    await emailPage.bringToFront().catch(() => {});

    // Copy the run-wide set so earlier-service emails are already excluded,
    // and so the verification email ID is also skipped in the playlist poll (step 5)
    // without leaking new IDs back into the shared set.
    const seenIds = new Set(inboxSeenIds);

    const code = await waitForVerificationCodeEmail(emailPage, {
      seenIds,
      timeout: 120_000,
    });
    if (!code)
      throw new Error(
        "[OneIPTV4K] Verification code not received — check inbox or site behaviour.",
      );
    log(`[OneIPTV4K] Got verification code: ${code}`);

    // 4. Enter the verification code on the site
    log("[OneIPTV4K] Entering verification code on site...");
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(600);
    await fillFirst(page, SELECTORS.codeInput, code);
    await page.waitForTimeout(300);
    await clickFirst(page, SELECTORS.codeSubmit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);
    log("[OneIPTV4K] ✅ Code submitted.");

    // 5. Poll inbox for the playlist email (verification email already in seenIds)
    log("[OneIPTV4K] Waiting for M3U playlist email...");
    await emailPage.bringToFront().catch(() => {});
    const playlists = await waitForPlaylistEmail(emailPage, {
      seenIds,
      timeout: 120_000,
    });

    // 6. Build and return result
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      },
    );

    log(
      `[OneIPTV4K] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}, total links: ${playlists.allM3uLinks.length}`,
    );

    return {
      username: name,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? "24 Hours",
      expiresAt: playlists.expiresAt ?? expiresAt,
      status: "success",
      note: playlists.tvPlaylist
        ? "24-hour IPTV trial activated successfully."
        : "Registered — M3U links not found in confirmation email.",
    };
  },
};

export default OneIptv4kRegistration;
