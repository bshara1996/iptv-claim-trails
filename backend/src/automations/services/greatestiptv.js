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
import { computeTrialExpiry } from "../utils/generators.js";
import { findVisible, clickFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://www.greatestiptv.com/free-trial/";
const TAG = "GreatestIPTV";
const MAX_RETRIES = 10;
const TRIAL_HOURS = 36;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  email: "#trial_email",
  trialTypeM3u: ".sc-card-opt",
  submit: "#trial_submit",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns true if the page text contains any known post-activation confirmation phrase.
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
      "GreatestIPTV 36-hour free trial — email submission + M3U playlist",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Open the trial page
    await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.email, { state: "visible", timeout: 10_000 })
      .catch(() => {});

    // Ensure M3U Playlist option is selected (it's the default but click to be safe)
    await clickFirst(page, SELECTORS.trialTypeM3u);

    // Step 2: Submit the form, retrying until confirmation appears
    let confirmed = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const emailField = await findVisible(page, SELECTORS.email);
      if (!emailField) {
        await page.waitForTimeout(1_500);
        continue;
      }

      await emailField.fill(email);

      const submitBtn = await findVisible(page, SELECTORS.submit);
      if (submitBtn) await submitBtn.click();

      // Wait for either the network to settle or a short timeout before checking.
      await page
        .waitForLoadState("networkidle", { timeout: 3_000 })
        .catch(() => {});

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

    // Step 3: Poll the inbox for the access-details email
    await emailPage.bringToFront().catch(() => {});

    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      {
        filterText: "greatest",
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (playlists.allM3uLinks.length === 0)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
    else
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    return {
      username: null,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks,
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: playlists.tvPlaylist
        ? "36-hour GreatestIPTV trial activated successfully."
        : "Trial activated — M3U link not found in confirmation email.",
    };
  },
};
