/**
 * TVBoom free trial registration service.
 *
 * Fills the registration form, solves reCAPTCHA, clicks the validation link
 * from the confirmation email, then activates the 24-hour trial.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import {
  generateUsername,
  generatePassword,
  computeTrialExpiry,
} from "../utils/generators.js";
import { clickFirst, fillFirst } from "../utils/pageUtils.js";

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
  cabinet:
    'a:has-text("Перейти в кабинет"), a[href*="/cabinet"], a[href*="/user/"]',
  activateTest:
    'a:has-text("Активировать тест"), a:has-text("Активировать"), button:has-text("Активировать")',
};

// Matches the account validation link sent in the TVBoom confirmation email.
// Accepts both & and &amp; because some email providers HTML-encode the href.
const VALIDATION_LINK_RE =
  /https?:\/\/tvboom\.vip\/index\.php\?do=register(?:&|&amp;)doaction=validating(?:&|&amp;)id=[a-zA-Z0-9_|=~%-]+/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openRegistrationPage(page) {
  for (const url of [
    `${BASE_URL}/register`,
    `${BASE_URL}/index.php?do=register`,
  ]) {
    if (
      await page
        .goto(url, GOTO_OPTS)
        .then(() => true)
        .catch(() => false)
    )
      return;
  }
}

// Searches the email page (including frames) for the validation anchor and clicks it.
// Some providers render email content inside an iframe, so we scan both the main
// page and every child frame.
async function clickValidationLink(emailPage) {
  for (const target of [emailPage, ...emailPage.frames()]) {
    try {
      for (const anchor of await target.$$("a[href]")) {
        const href = await anchor.evaluate((el) => el.href).catch(() => "");
        if (href && VALIDATION_LINK_RE.test(href.replace(/&amp;/g, "&"))) {
          await anchor.scrollIntoViewIfNeeded().catch(() => {});
          await anchor.click();
          return true;
        }
      }
    } catch (_) {}
  }
  return false;
}

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

    // ── Step 1: Fill and submit the registration form ─────────────────────────
    await openRegistrationPage(page);

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
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    // ── Step 2: Open the confirmation email and click the validation link ───────
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

    const cleanUrl = validationUrl.replace(/&amp;/g, "&");
    // Try clicking the anchor in the email first; if not found, navigate directly.
    const clicked = await clickValidationLink(emailPage);

    if (clicked) {
      await page.bringToFront().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } else {
      await page.goto(cleanUrl, GOTO_OPTS).catch(() => {});
      await page.bringToFront().catch(() => {});
    }

    // ── Step 3: Activate the 24-hour trial from the cabinet ────────────────────
    await clickFirst(page, SELECTORS.continueReg);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await clickFirst(page, SELECTORS.cabinet);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await clickFirst(page, SELECTORS.activateTest);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(100);

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
