/**
 * Y6TV free trial registration service.
 *
 * Fills the registration form, solves the reCAPTCHA, then polls the inbox
 * for a confirmation email containing the M3U playlist links.
 * Trial duration is 3 days (72 hours).
 */
import { solveAndSubmit } from "../utils/captcha.js";
import { computeTrialExpiry } from "../utils/generators.js";
import { fillFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://rg.y6tv.me/regfm.php?devTypeID=100";
const TAG = "Y6TV";
const TRIAL_HOURS = 72;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 10_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  email: 'input[name="email"]',
  submit: "#regBtn",
  error: ".regFormErrInf",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Navigates to the registration page, fills the email field, solves the CAPTCHA,
// submits the form, and throws if the server returns a validation error.
async function submitForm(page, email, log) {
  await page
    .goto(TRIAL_URL, GOTO_OPTS)
    .catch(() =>
      log(`[${TAG}] Page load timeout — proceeding with current DOM.`, "warn"),
    );

  await page
    .waitForSelector(SELECTORS.email, { timeout: 5_000, state: "visible" })
    .catch(() => {});

  await fillFirst(page, SELECTORS.email, email);

  // Start waiting for navigation BEFORE the submit click so we don't miss it.
  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
    .catch(() => {});

  await solveAndSubmit(page, {
    submitSelectors: SELECTORS.submit,
    log,
    tag: TAG,
  });
  // Check for server-side validation errors after submission.
  await navPromise;

  const errorText = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.innerText?.trim() ?? null,
      SELECTORS.error,
    )
    .catch(() => null);
  if (errorText) throw new Error(`Registration rejected: ${errorText}`);

  log(`[${TAG}] Registration submitted successfully.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "y6tv",
    name: "Y6TV",
    url: TRIAL_URL,
    description: "Y6TV IPTV free trial registration",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // 1. Fill and submit the registration form
    await submitForm(page, email, log);

    // 2. Poll the inbox for the confirmation email with M3U links.
    // A defensive copy of inboxSeenIds prevents the poller from mutating
    // the run-wide set shared across services.
    await emailPage.bringToFront().catch(() => {});

    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      {
        filterText: "y6tv",
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

    // 3. Build the result
    // Prefer duration/expiry values extracted from the confirmation email
    // (when available) and fall back to the TRIAL_HOURS default otherwise.
    const defaultExpiresAt = computeTrialExpiry(TRIAL_HOURS);

    return {
      username: null,
      password: null,
      email,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? `${TRIAL_HOURS / 24} Days`,
      expiresAt: playlists.expiresAt ?? defaultExpiresAt,
      status: "success",
      note: playlists.tvPlaylist
        ? "M3U playlist links extracted from confirmation email."
        : "Registered — no playlist links found in confirmation email.",
    };
  },
};
