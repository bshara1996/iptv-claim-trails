/**
 * TVBoom free trial registration service.
 *
 * Flow:
 *   1. Accept the terms page, fill the registration form, solve reCAPTCHA.
 *   2. Poll the inbox for the confirmation email and navigate to the validation link.
 *   3. Continue registration, go to the cabinet, activate the 24-hour trial.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import {
  generateUsername,
  generatePassword,
  computeTrialExpiry,
} from "../utils/generators.js";
import { clickFirst, fillFirst, waitAndClick } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://tvboom.vip";
const TAG = "TVBoom";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 15_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  rulesAccept: '#registration input.bbcodes[type="submit"]',
  username: "#name",
  email: "#email",
  password: "#password1",
  passwordRepeat: "#password2",
  submit: 'button[name="submit"][type="submit"]',
  continueReg:
    'a:has-text("Продолжить регистрацию"), button:has-text("Продолжить регистрацию")',
  cabinet: 'a:has-text("Перейти в кабинет"), a[href*="/cabinet"]',
  activateTest: 'a[onclick*="GetTest"]',
};

// Matches the TVBoom validation link; tolerates &amp; HTML-encoding.
const VALIDATION_LINK_RE =
  /https?:\/\/tvboom\.vip\/index\.php\?do=register(?:&|&amp;)doaction=validating(?:&|&amp;)id=[a-zA-Z0-9_|=~%-]+/i;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvboom",
    name: "TVBoom",
    url: `${BASE_URL}/register`,
    description: "TVBoom 24-hour IPTV trial registration & activation",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();
    const password = generatePassword();

    // Step 1: Accept terms, fill form, submit
    await page.goto(`${BASE_URL}/register`, GOTO_OPTS).catch(() => {});
    if (await clickFirst(page, SELECTORS.rulesAccept))
      await page.waitForLoadState("domcontentloaded").catch(() => {});

    await fillFirst(page, SELECTORS.username, username);
    await fillFirst(page, SELECTORS.email, email);
    await fillFirst(page, SELECTORS.password, password);
    await fillFirst(page, SELECTORS.passwordRepeat, password);
    await solveAndSubmit(page, {
      submitSelectors: SELECTORS.submit,
      log,
      tag: TAG,
    });

    // Step 2: Poll inbox and navigate to the validation link
    await emailPage.bringToFront().catch(() => {});
    const validationUrl = await provider.waitForEmailAndExtractLink(emailPage, {
      filterText: "tvboom",
      pattern: VALIDATION_LINK_RE,
      seenIds: inboxSeenIds,
      timeout: 60_000,
    });
    if (!validationUrl)
      throw new Error(
        "Validation link not found in TVBoom confirmation email.",
      );

    await page
      .goto(validationUrl.replace(/&amp;/g, "&"), GOTO_OPTS)
      .catch(() => {});
    await page.bringToFront().catch(() => {});

    // Step 3: Continue registration, go to cabinet, activate trial
    await clickFirst(page, SELECTORS.continueReg);
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    await clickFirst(page, SELECTORS.cabinet);

    await waitAndClick(page, SELECTORS.activateTest);
    await page.waitForTimeout(1_300);

    const tvPlaylist = `${BASE_URL}/${username}/${password}/hls/playlist.m3u8`;
    log(`[${TAG}] ✅ Trial activated. Playlist: ${tvPlaylist}`);

    return {
      username,
      password,
      tvPlaylist,
      vodPlaylist: null,
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      allM3uLinks: [tvPlaylist],
      status: "success",
      note: "24-hour IPTV trial activated successfully.",
    };
  },
};
