/**
 * OneIPTV4K free trial registration service.
 *
 * Flow:
 *   1. Open the registration page and fill the form (name, email, WhatsApp).
 *   2. Submit and wait for the verification code email.
 *   3. Enter the code on the site to confirm.
 *   4. Poll the inbox for the playlist email and return the result.
 */
import {
  generateUsername,
  generatePhone,
  computeTrialExpiry,
} from "../utils/generators.js";
import { fillInstant, clickFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://oneiptv4k.com/free-trial";
const TAG = "OneIPTV4K";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: 'input[name="name"]',
  email: 'input[name="email"]',
  whatsapp: 'input[name="whatsapp"]',
  submit: 'button[type="submit"]',
  codeInput: 'input[name="code"]',
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

    // Step 1: Fill and submit the registration form
    await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
    await fillInstant(page, {
      [SELECTORS.name]: name,
      [SELECTORS.email]: email,
      [SELECTORS.whatsapp]: whatsapp,
    });
    await page.waitForTimeout(400);
    await clickFirst(page, SELECTORS.submit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    // Step 2: Poll inbox for the verification code
    await emailPage.bringToFront().catch(() => {});
    const seenIds = new Set(inboxSeenIds);
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "oneiptv4k",
      seenIds,
      timeout: 120_000,
    });
    if (!code) throw new Error(`[${TAG}] Verification code not received.`);

    // Step 3: Enter the verification code
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(600);
    await fillInstant(page, { [SELECTORS.codeInput]: code });
    await page.waitForTimeout(300);
    await clickFirst(page, SELECTORS.submit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    // Step 4: Poll inbox for the playlist email
    await emailPage.bringToFront().catch(() => {});
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      { seenIds, timeout: 120_000 },
    );

    log(
      `[${TAG}] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}, total links: ${playlists.allM3uLinks.length}`,
    );

    return {
      username: name,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: playlists.tvPlaylist
        ? "24-hour IPTV trial activated successfully."
        : "Registered — M3U links not found in confirmation email.",
    };
  },
};
