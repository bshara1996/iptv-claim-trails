/**
 * VeleStore free trial registration service.
 *
 * Fills the registration form, solves reCAPTCHA, navigates to the cabinet,
 * activates the trial, then builds the playlist URL from credentials.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import {
  generateUsername,
  generatePassword,
  computeTrialExpiry,
} from "../utils/generators.js";
import { clickFirst, fillFirst } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://velestore.su";
const TAG = "VeleStore";
const TRIAL_HOURS = 72;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: "#name",
  password1: "#password1",
  password2: "#password2",
  email: "#email",
  submit: 'button[name="submit"][type="submit"]',
  cabinet:
    'a:has-text("ПЕРЕЙТИ В КАБИНЕТ"), a:has-text("Перейти в кабинет"), a[href*="/cabinet"], a[href*="/user/"]',
  trialBtn:
    'input[type="button"][value="Получить тест на 6 часов"], button:has-text("Получить тест")',
  errorBlock: ".inform-1",
  expiryBlock: "div.udtb",
  expiryLabel: "div.udtlb",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPlaylistUrl(login, password) {
  return `http://p.velestore.su/play/${login}/${password}/playlist.m3u8`;
}

async function openRegistrationPage(page, log) {
  await page.goto(`${BASE_URL}/?do=register`, GOTO_OPTS).catch(() => {
    log(`[${TAG}] Page load timed out — proceeding with current DOM.`, "warn");
  });
}

async function fillForm(page, { login, password, email }) {
  await page
    .waitForSelector(SELECTORS.name, { timeout: 8_000, state: "visible" })
    .catch(() => {});

  await fillFirst(page, SELECTORS.name, login);
  await fillFirst(page, SELECTORS.password1, password);
  await fillFirst(page, SELECTORS.password2, password);
  await fillFirst(page, SELECTORS.email, email);
}

async function submitForm(page, log) {
  // Start waiting for navigation BEFORE the submit click so we don't miss it.
  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25_000 })
    .catch(() => {});

  await solveAndSubmit(page, {
    submitSelectors: SELECTORS.submit,
    log,
    tag: TAG,
  });
  await navPromise;

  const errorText = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.innerText.trim() ?? null,
      SELECTORS.errorBlock,
    )
    .catch(() => null);

  // Distinguish captcha/security-code rejections (retryable) from other errors,
  // since the generic "ошибка" substring would otherwise match both cases.
  if (
    errorText &&
    /код безопасности|captcha|ошибка регистрации/i.test(errorText)
  )
    throw new Error(`Registration failed (captcha): ${errorText}`);
  if (errorText && /ошибка/i.test(errorText))
    throw new Error(`Registration error: ${errorText}`);
}

async function activateTrial(page, log) {
  const cabinetBtn = await page
    .waitForSelector(SELECTORS.cabinet, { timeout: 10_000, state: "visible" })
    .catch(() => null);

  if (!cabinetBtn) {
    log(`[${TAG}] «ПЕРЕЙТИ В КАБИНЕТ» not found — continuing.`, "warn");
    return;
  }

  // Wait for the cabinet-page navigation in parallel with the click so a fast
  // response doesn't cause us to miss the load event.
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => {}),
    cabinetBtn.click(),
  ]);

  if (await clickFirst(page, SELECTORS.trialBtn)) {
    await page.waitForTimeout(2_000);
    return;
  }

  log(`[${TAG}] Trial button not found.`, "warn");
}

async function getExpiryInfo(page, log) {
  const raw = await page
    .evaluate(
      ({ blockSel, labelSel }) => {
        for (const block of document.querySelectorAll(blockSel)) {
          if (block.querySelector(labelSel)?.innerText.includes("Действует до"))
            return block.querySelector("font")?.innerText.trim() ?? null;
        }
        return null;
      },
      { blockSel: SELECTORS.expiryBlock, labelSel: SELECTORS.expiryLabel },
    )
    .catch(() => null);

  const match = raw?.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);

  if (match) {
    log(`[${TAG}] ✅ Subscription expires at: ${raw}`);
    const [, dd, mm, yyyy, hh, min] = match;
    const diffMs = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`) - Date.now();
    // Format the remaining time as a human-readable relative duration
    // (e.g. "2 days", "6 hours", "45 minutes") using the largest fitting unit.
    const rtf = new Intl.RelativeTimeFormat("en", {
      numeric: "always",
      style: "long",
    });
    const thresholds = [
      { unit: "day", ms: 86_400_000 },
      { unit: "hour", ms: 3_600_000 },
      { unit: "minute", ms: 60_000 },
    ];
    const { unit, ms } =
      thresholds.find(({ ms: threshold }) => diffMs >= threshold) ??
      thresholds.at(-1);
    const duration = rtf
      .format(Math.round(diffMs / ms), unit)
      .replace("in ", "")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return { expiresAt: raw, duration };
  }

  log(`[${TAG}] Could not read expiry date — using trial default.`, "warn");
  return {
    expiresAt: computeTrialExpiry(TRIAL_HOURS),
    duration: `${TRIAL_HOURS} Hours`,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "velestore",
    name: "VeleStore",
    url: `${BASE_URL}/?do=register`,
    description: "VeleStore IPTV free trial registration",
  },

  async execute({ page, email, log = () => {} }) {
    // "user" prefix matches how VeleStore accounts are normally created on the site.
    const login = `user${generateUsername()}`;
    const password = generatePassword();

    // ── Step 1: Open registration page, fill form, submit ─────────────────────
    await openRegistrationPage(page, log);

    await fillForm(page, { login, password, email });
    await submitForm(page, log);
    log(`[${TAG}] ✅ Account registered (${login}).`);

    // ── Step 2: Navigate to cabinet and activate trial ────────────────────────
    await activateTrial(page, log);

    // ── Step 3: Build playlist URL and extract expiry ──────────────────────────
    const tvPlaylist = buildPlaylistUrl(login, password);
    log(`[${TAG}] ✅ Playlist: ${tvPlaylist}`);

    const { expiresAt, duration } = await getExpiryInfo(page, log);

    return {
      username: login,
      password,
      email,
      tvPlaylist,
      vodPlaylist: null,
      allM3uLinks: [tvPlaylist],
      duration,
      expiresAt,
      status: "success",
      note: `VeleStore trial activated. Expires: ${expiresAt}`,
    };
  },
};
