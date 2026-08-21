/**
 * GreatestIPTV — Free Trial Registration
 *
 * Flow:
 *   1. Open the free-trial page and wait for the email field.
 *   2. Fill the email and click "Activate Free Trial".
 *      Retry up to MAX_RETRIES times until the "TRIAL ACTIVATED" confirmation appears.
 *   3. Switch to the inbox page and poll for the access-details email.
 *   4. Extract and return the M3U playlist link.
 */
import { waitForPlaylistEmail } from "../providers/inboxPoller.js";
import { computeExpiresAt } from "../utils/generators.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://www.greatestiptv.com/free-trial/";
const TAG = "GreatestIPTV";
const MAX_RETRIES = 10;
const TRIAL_HOURS = 36;

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  // Email input on the free-trial page
  email: ["#trial_email", 'input[name="email"]', 'input[type="email"]'],

  // "Activate Free Trial" submit button
  submit: ['button[type="submit"]', 'input[type="submit"]'],

  // Elements present only after a successful activation
  confirmation: [
    ':has-text("TRIAL ACTIVATED")',
    ':has-text("You\'re In")',
    ':has-text("Your access details are being sent")',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the first element from `selectors` that exists and is visible, or null.
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Returns true when the page body contains any of the confirmation phrases.
// Reading innerText is more reliable than selector-based checks because the
// confirmation card is injected dynamically after the AJAX response.
async function isConfirmed(page) {
  const text = await page
    .evaluate(() => document.body?.innerText ?? "")
    .catch(() => "");
  return (
    text.includes("TRIAL ACTIVATED") ||
    text.includes("Your access details are being sent") ||
    /you['']?re\s+in/i.test(text)
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "greatestiptv",
    name: "GreatestIPTV",
    url: TRIAL_URL,
    description:
      "GreatestIPTV 24-hour free trial — email submission + M3U playlist",
  },

  async execute({
    page,
    emailPage,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // ── Step 1: Open the trial page ───────────────────────────────────────────
    await page
      .goto(TRIAL_URL, { waitUntil: "domcontentloaded", timeout: 20_000 })
      .catch(() => {});
    // Wait for the email field before interacting — the form may load after DOMContentLoaded
    await page
      .waitForSelector(SELECTORS.email[0], {
        timeout: 10_000,
        state: "visible",
      })
      .catch(() => {});

    // ── Step 2: Submit the form, retry until confirmation appears ─────────────
    // The site sometimes ignores the first submission, so we keep re-filling and
    // re-clicking until the "TRIAL ACTIVATED" card becomes visible.
    let confirmed = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const emailField = await findVisible(page, SELECTORS.email);
      if (!emailField) {
        // Field not ready yet — wait briefly and try again
        await page.waitForTimeout(1_500);
        continue;
      }

      await emailField.fill(email);

      const submitBtn = await findVisible(page, SELECTORS.submit);
      if (submitBtn) await submitBtn.click();

      // Wait for either the confirmation element or the network to settle,
      // whichever comes first, before checking the page state.
      await Promise.race([
        page
          .waitForSelector(SELECTORS.confirmation[0], {
            timeout: 3_000,
            state: "visible",
          })
          .catch(() => {}),
        page
          .waitForLoadState("networkidle", { timeout: 3_000 })
          .catch(() => {}),
      ]);

      if (await isConfirmed(page)) {
        log(`[${TAG}] ✅ Trial activated on attempt ${attempt}.`);
        confirmed = true;
        break;
      }

      await page.waitForTimeout(500);
    }

    if (!confirmed)
      throw new Error(
        `[${TAG}] Trial activation not confirmed after ${MAX_RETRIES} attempts.`,
      );

    // ── Step 3: Poll the inbox for the access-details email ───────────────────
    // Switch focus to the email tab; the poller will refresh and open the email.
    // filterText "greatest" matches the subject "Your Free Trial is Ready - Greatest IPTV".
    // A fresh copy of inboxSeenIds ensures emails from earlier services are skipped.
    await emailPage.bringToFront().catch(() => {});

    const playlists = await waitForPlaylistEmail(emailPage, {
      filterText: "greatest",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    // ── Step 4: Return the result ─────────────────────────────────────────────
    if (playlists.allM3uLinks.length === 0)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
    else
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    const expiresAt = computeExpiresAt(TRIAL_HOURS * 60 * 60 * 1000);

    return {
      username: null,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks,
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt,
      status: "success",
      note: playlists.tvPlaylist
        ? "24-hour GreatestIPTV trial activated successfully."
        : "Trial activated — M3U link not found in confirmation email.",
    };
  },
};
