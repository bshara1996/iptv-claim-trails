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
  generateUsername,
  generatePhone,
  computeTrialExpiry,
} from "../utils/generators.js";
import { findVisible, fillFirst, clickFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://oneiptv4k.com/free-trial";
const TRIAL_HOURS = 24;

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

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "oneiptv4k",
    name: "OneIPTV4K",
    url: TRIAL_URL,
    description:
      "OneIPTV4K 24-hour free trial — email code verification + M3U playlist",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const name = generateUsername();
    const whatsapp = generatePhone();

    // 1. Open registration page
    await page
      .goto(TRIAL_URL, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })
      .catch(() =>
        logger.warn(
          "[OneIPTV4K] Page load timed out — proceeding with current DOM.",
        ),
      );

    // 2. Fill and submit the registration form
    await fillFirst(page, SELECTORS.name, name);
    await fillFirst(page, SELECTORS.email, email);
    await fillFirst(page, SELECTORS.whatsapp, whatsapp);
    await page.waitForTimeout(400);
    await clickFirst(page, SELECTORS.submit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    // 3. Poll inbox for the verification code
    await emailPage.bringToFront().catch(() => {});

    // Copy the run-wide set so earlier-service emails are already excluded,
    // and so the verification email ID is also skipped in the playlist poll (step 5)
    // without leaking new IDs back into the shared set.
    const seenIds = new Set(inboxSeenIds);

    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      seenIds,
      timeout: 120_000,
    });
    if (!code)
      throw new Error(
        "[OneIPTV4K] Verification code not received — check inbox or site behaviour.",
      );

    // 4. Enter the verification code on the site
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(600);
    await fillFirst(page, SELECTORS.codeInput, code);
    await page.waitForTimeout(300);
    await clickFirst(page, SELECTORS.codeSubmit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    // 5. Poll inbox for the playlist email (verification email already in seenIds)
    await emailPage.bringToFront().catch(() => {});
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      {
        seenIds,
        timeout: 120_000,
      },
    );

    // 6. Build and return result
    const expiresAt = computeTrialExpiry(TRIAL_HOURS);

    log(
      `[OneIPTV4K] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}, total links: ${playlists.allM3uLinks.length}`,
    );

    return {
      username: name,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt: playlists.expiresAt ?? expiresAt,
      status: "success",
      note: playlists.tvPlaylist
        ? "24-hour IPTV trial activated successfully."
        : "Registered — M3U links not found in confirmation email.",
    };
  },
};
