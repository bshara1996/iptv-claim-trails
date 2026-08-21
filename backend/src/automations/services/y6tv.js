/**
 * Y6TV free trial registration service.
 *
 * Fills the registration form, solves the reCAPTCHA, then polls the inbox
 * for a confirmation email containing the M3U playlist links.
 * Trial duration is 3 days.
 */
import logger from "../../logger.js";
import { waitForPlaylistEmail } from "../providers/inboxPoller.js";
import { solveAndSubmit } from "../utils/captcha.js";
import { computeExpiresAt } from "../utils/generators.js";

const TRIAL_DAYS = 3;

// ── Selectors ─────────────────────────────────────────────────────────────────

const EMAIL_SELECTORS = [
  'input[name="email"]',
  'input[placeholder="E-Mail"]',
  'input[placeholder*="mail" i]',
  'input[type="email"]',
  'input[type="text"]',
];

const SUBMIT_SELECTORS = [
  "#regBtn",
  'input[name="regBtn"]',
  'input[value="Зарегистрировать"]',
  "input.regFormBtn",
  'button[type="submit"]',
  'input[type="submit"]',
];

const ERROR_SELECTORS = [
  ".error",
  ".alert-error",
  ".alert-danger",
  ".registration-error",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the first visible element matching any selector, or null
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) return el;
    } catch (_) {}
  }
  return null;
}

// Navigates to the registration page, fills the email field, solves the CAPTCHA,
// submits the form, and throws if the server returns a validation error
async function submitForm(page, email, log) {
  await page
    .goto("https://rg.y6tv.me/regfm.php?devTypeID=100", {
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    })
    .catch(() =>
      logger.warn("[Y6TV] Page load timeout — proceeding with current DOM."),
    );

  await page
    .waitForSelector(EMAIL_SELECTORS[0], { timeout: 5_000 })
    .catch(() => {});

  const emailField = await findVisible(page, EMAIL_SELECTORS);
  if (!emailField)
    throw new Error("Email field not found on the Y6TV registration page.");

  await emailField.click().catch(() => {});
  await emailField.fill(email);

  // Start waiting for navigation before the submit click so we don't miss it
  const navPromise = page
    .waitForNavigation({ waitUntil: "load", timeout: 15_000 })
    .catch(() => {});

  await solveAndSubmit(page, {
    submitSelectors: SUBMIT_SELECTORS,
    log,
    tag: "Y6TV",
  });
  await navPromise;

  // Check for server-side validation errors after submission
  const errorText = await page.evaluate(
    (sels) =>
      sels.reduce(
        (found, s) =>
          found ?? document.querySelector(s)?.innerText?.trim() ?? null,
        null,
      ),
    ERROR_SELECTORS,
  );
  if (errorText) throw new Error(`Registration rejected: ${errorText}`);

  logger.info("[Y6TV] Registration submitted successfully.");
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "y6tv",
    name: "Y6TV",
    url: "https://rg.y6tv.me/regfm.php?devTypeID=100",
    description: "Y6TV IPTV free trial registration",
  },

  async execute({
    page,
    emailPage,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    await submitForm(page, email, log);

    await emailPage.bringToFront().catch(() => {});

    const playlists = await waitForPlaylistEmail(emailPage, {
      filterText: "y6tv",
      // Pass the run-wide seen-IDs set so emails from earlier services are excluded
      seenIds: inboxSeenIds,
      timeout: 120_000,
    });

    if (playlists.allM3uLinks.length === 0)
      log("[Y6TV] No M3U links found in confirmation email.", "warn");

    const expiresAt = computeExpiresAt(TRIAL_DAYS * 864e5);

    return {
      email,
      tvPlaylist: playlists.tvPlaylist,
      vodPlaylist: playlists.vodPlaylist,
      allM3uLinks: playlists.allM3uLinks,
      duration: `${TRIAL_DAYS} Days`,
      expiresAt,
      status: "success",
      note: playlists.tvPlaylist
        ? "M3U playlist links extracted from confirmation email."
        : "Registered — no playlist links found in confirmation email.",
    };
  },
};
