import logger from "../../logger.js";
import {
  waitForVerificationCodeEmail,
  waitForPlaylistEmail,
} from "../providers/inboxPoller.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://oneiptv4k.com";
const TRIAL_PATH = "/free-trial";

// ─── Selectors ────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomAlphanumeric(n) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: n },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function generateCredentials() {
  const name = randomAlphanumeric(8);
  // 10-digit WhatsApp number starting with a non-zero digit
  const whatsapp =
    String(Math.floor(1 + Math.random() * 9)) +
    String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  return { name, whatsapp };
}

// Returns the first visible element whose selector matches, or null.
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

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

async function clickFirst(page, selectors) {
  const el = await findVisible(page, selectors);
  if (!el) {
    logger.warn(`[OneIPTV4K] Button not found for selectors: ${selectors[0]}`);
    return;
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click();
}

// ─── Service ──────────────────────────────────────────────────────────────────

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
    const { name, whatsapp } = generateCredentials();

    // ── Step 1: Open registration page ────────────────────────────────────────
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

    // ── Step 2: Fill & submit the registration form ────────────────────────────
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

    // ── Step 3: Poll inbox for verification code ───────────────────────────────
    log("[OneIPTV4K] Waiting for verification code email...");
    await emailPage.bringToFront().catch(() => {});

    // Copy the run-wide set into a local one. This does two things:
    //   1. Emails seen by any earlier service in this run are already excluded.
    //   2. The local copy is reused for the playlist poll in step 5, so the
    //      verification-code email itself is also skipped there.
    // We copy rather than use inboxSeenIds directly so new IDs discovered in
    // this service's polls don't leak back into the shared set and accidentally
    // hide emails that a later service might legitimately need.
    const seenIds = new Set(inboxSeenIds);

    const code = await waitForVerificationCodeEmail(emailPage, {
      seenIds,
      timeout: 120_000,
    });

    if (!code) {
      throw new Error(
        "[OneIPTV4K] Verification code not received — check inbox or site behaviour.",
      );
    }
    log(`[OneIPTV4K] Got verification code: ${code}`);

    // ── Step 4: Submit the verification code ──────────────────────────────────
    log("[OneIPTV4K] Entering verification code on site...");
    await page.bringToFront().catch(() => {});
    await page.waitForTimeout(600);

    await fillFirst(page, SELECTORS.codeInput, code);
    await page.waitForTimeout(300);
    await clickFirst(page, SELECTORS.codeSubmit);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1_000);

    log("[OneIPTV4K] ✅ Code submitted.");

    // ── Step 5: Poll inbox for the playlist email ──────────────────────────────
    log("[OneIPTV4K] Waiting for M3U playlist email...");
    await emailPage.bringToFront().catch(() => {});

    const playlists = await waitForPlaylistEmail(emailPage, {
      seenIds, // skip the already-seen verification code email
      timeout: 120_000,
    });

    // ── Step 6: Return result ──────────────────────────────────────────────────
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
      email,
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
