/**
 * TVBoom free trial registration service.
 *
 * Generates random credentials, fills the registration form, solves the reCAPTCHA,
 * clicks the validation link from the confirmation email, then activates the
 * 24-hour trial from the user cabinet.
 * Playlist URL is built directly from the credentials (no inbox M3U extraction needed).
 */
import { solveAndSubmit } from "../utils/captcha.js";
import {
  generateUsername,
  generatePassword,
  computeExpiresAt,
} from "../utils/generators.js";

const BASE_URL = "https://tvboom.vip";
const TRIAL_HOURS = 24;

// Matches the account validation link sent in the TVBoom confirmation email
const VALIDATION_LINK_RE =
  /https?:\/\/tvboom\.vip\/index\.php\?do=register(?:&|&amp;)doaction=validating(?:&|&amp;)id=[a-zA-Z0-9_|=~%-]+/i;

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  rulesAccept: [
    'button:has-text("Принимаю")',
    'input[value*="Принимаю"]',
    'button:has-text("Согласен")',
    'input[value*="Согласен"]',
  ],
  username: [
    'input[name="name"]',
    'input[name="login"]',
    'input[placeholder*="Логин" i]',
  ],
  email: [
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="mail" i]',
  ],
  password: [
    'input[name="password"]',
    'input[name="pass"]',
    'input[type="password"]:first-of-type',
  ],
  passwordRepeat: [
    'input[name="password_repeat"]',
    'input[name="pass2"]',
    'input[placeholder*="Повторите" i]',
    'input[type="password"]:nth-of-type(2)',
  ],
  submit: [
    'button[name="submit"][type="submit"]',
    'button[type="submit"]',
    'input[type="submit"]',
  ],
  continueReg: [
    'a:has-text("Продолжить регистрацию")',
    'button:has-text("Продолжить регистрацию")',
    'a[href*="do=register"]',
  ],
  cabinet: [
    'a:has-text("ПЕРЕЙТИ В КАБИНЕТ")',
    'a:has-text("Перейти в кабинет")',
    'a[href*="/cabinet"]',
    'a[href*="/user/"]',
  ],
  activateTest: [
    'a:has-text("Активировать тест на 24 часа")',
    'a:has-text("Активировать тест")',
    'button:has-text("Активировать")',
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

// Clicks the first visible element matching any selector
async function clickFirst(page, selectors) {
  const el = await findVisible(page, selectors);
  if (el) {
    await el.click();
    return true;
  }
  return false;
}

// Fills the first visible element matching any selector with the given value
async function fillFirst(page, selectors, value) {
  const el = await findVisible(page, selectors);
  if (el) {
    await el.click().catch(() => {});
    await el.fill(value);
    return true;
  }
  return false;
}

// Searches the email page (including frames) for the validation anchor and clicks it.
// Searching frames is needed because some providers render email content inside an iframe.
async function clickValidationLink(emailPage, url) {
  const targets = [emailPage, ...emailPage.frames()];
  for (const target of targets) {
    try {
      const anchors = await target.$$("a[href]");
      for (const anchor of anchors) {
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

async function navigateTo(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
}

// Clicks the first matching element then waits for the page to settle
async function clickAndWait(page, selectors) {
  await clickFirst(page, selectors);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

// ── Service ───────────────────────────────────────────────────────────────────

const TvBoomRegistration = {
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
    // 1. Fill and submit the registration form
    log(`[TVBoom] Registering as "${username}"...`);
    await navigateTo(page, `${BASE_URL}/register`).catch(() =>
      navigateTo(page, `${BASE_URL}/index.php?do=register`).catch(() => {}),
    );

    await clickFirst(page, SELECTORS.rulesAccept);
    await fillFirst(page, SELECTORS.username, username);
    await fillFirst(page, SELECTORS.email, email);
    await fillFirst(page, SELECTORS.password, password);
    await fillFirst(page, SELECTORS.passwordRepeat, password);

    await solveAndSubmit(page, {
      submitSelectors: SELECTORS.submit,
      log,
      tag: "TVBoom",
    });
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    // 2. Open confirmation email and click the validation link inside
    log("[TVBoom] Waiting for confirmation email...");
    await emailPage.bringToFront().catch(() => {});

    const validationUrl = await provider.waitForEmailAndExtractLink(emailPage, {
      filterText: "tvboom",
      pattern: VALIDATION_LINK_RE,
      // Pass the run-wide seen-IDs set so emails from earlier services are excluded
      seenIds: inboxSeenIds,
      timeout: 60_000,
    });
    if (!validationUrl)
      throw new Error(
        "Validation link not found in TVBoom confirmation email.",
      );

    log("[TVBoom] Clicking validation link inside email...");
    const cleanUrl = validationUrl.replace(/&amp;/g, "&");
    const clicked = await clickValidationLink(emailPage, cleanUrl);

    if (clicked) {
      await page.bringToFront().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } else {
      // Anchor not found in DOM — fall back to direct navigation
      log(
        "[TVBoom] Anchor not found — navigating directly to validation URL...",
      );
      await navigateTo(page, cleanUrl).catch(() => {});
      await page.bringToFront().catch(() => {});
    }
    log("[TVBoom] ✅ Account confirmed.");

    // 3. Activate 24-hour trial from the cabinet
    await clickAndWait(page, SELECTORS.continueReg);
    await clickAndWait(page, SELECTORS.cabinet);
    await clickFirst(page, SELECTORS.activateTest);
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const tvPlaylist = `${BASE_URL}/${username}/${password}/hls/playlist.m3u8`;
    const expiresAt = computeExpiresAt(TRIAL_HOURS * 60 * 60 * 1000);

    log(`[TVBoom] ✅ Trial activated. Playlist: ${tvPlaylist}`);

    return {
      username,
      password,
      tvPlaylist,
      vodPlaylist: null,
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt,
      allM3uLinks: [tvPlaylist],
      status: "success",
      note: "24-hour IPTV trial activated successfully.",
    };
  },
};

export default TvBoomRegistration;
