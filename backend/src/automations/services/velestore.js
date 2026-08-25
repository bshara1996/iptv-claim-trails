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
import { clickFirst, fillInstant } from "../utils/pageUtils.js";

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
  error: ".inform-1",
  cabinet: 'a:has-text("ПЕРЕЙТИ В КАБИНЕТ"), a:has-text("Перейти в кабинет")',
  trialBtn: 'input[type="button"][value="Получить тест на 6 часов"]',
  expiryBlock: "div.udtb",
  expiryLabel: "div.udtlb",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Navigates to the registration page, fills all fields, solves the CAPTCHA,
// submits the form, and throws if the server returns a validation error.
async function submitRegistration(page, { login, password, email }, log) {
  await page
    .goto(`${BASE_URL}/?do=register`, GOTO_OPTS)
    .catch(() =>
      log(
        `[${TAG}] Page load timed out — proceeding with current DOM.`,
        "warn",
      ),
    );

  await page
    .waitForSelector(SELECTORS.name, { state: "visible", timeout: 8_000 })
    .catch(() => {});

  await fillInstant(page, {
    [SELECTORS.name]: login,
    [SELECTORS.password1]: password,
    [SELECTORS.password2]: password,
    [SELECTORS.email]: email,
  });

  // Start waiting for navigation BEFORE the submit click so we don't miss it.
  const navPromise = page.waitForNavigation(GOTO_OPTS).catch(() => {});

  await solveAndSubmit(page, {
    submitSelectors: SELECTORS.submit,
    log,
    tag: TAG,
  });
  await navPromise;

  const errorText = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.innerText.trim() ?? null,
      SELECTORS.error,
    )
    .catch(() => null);

  // Distinguish captcha/security-code rejections from generic errors.
  if (
    errorText &&
    /код безопасности|captcha|ошибка регистрации/i.test(errorText)
  )
    throw new Error(`Registration failed (captcha): ${errorText}`);
  if (errorText && /ошибка/i.test(errorText))
    throw new Error(`Registration error: ${errorText}`);
}

// Clicks the cabinet link then activates the trial button.
async function activateTrial(page, log) {
  const cabinetBtn = await page
    .waitForSelector(SELECTORS.cabinet, { state: "visible", timeout: 10_000 })
    .catch(() => null);

  if (!cabinetBtn) {
    log(`[${TAG}] «ПЕРЕЙТИ В КАБИНЕТ» not found — continuing.`, "warn");
    return;
  }

  // Wait for navigation in parallel with the click so a fast response
  // doesn't cause us to miss the load event.
  await Promise.all([
    page.waitForNavigation(GOTO_OPTS).catch(() => {}),
    cabinetBtn.click(),
  ]);

  if (await clickFirst(page, SELECTORS.trialBtn)) {
    await page.waitForTimeout(2_000);
    return;
  }

  log(`[${TAG}] Trial button not found.`, "warn");
}

// Reads the expiry date from the cabinet page and returns it with a human-readable duration.
async function getExpiryInfo(page, log) {
  const raw = await page
    .evaluate(
      ({ blockSel, labelSel }) => {
        for (const block of document.querySelectorAll(blockSel))
          if (block.querySelector(labelSel)?.innerText.includes("Действует до"))
            return block.querySelector("font")?.innerText.trim() ?? null;
        return null;
      },
      { blockSel: SELECTORS.expiryBlock, labelSel: SELECTORS.expiryLabel },
    )
    .catch(() => null);

  // Expected format: "DD.MM.YYYY HH:MM"
  const match = raw?.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    log(`[${TAG}] Could not read expiry date — using trial default.`, "warn");
    return {
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      duration: `${TRIAL_HOURS} Hours`,
    };
  }

  const [, dd, mm, yyyy, hh, min] = match;
  const diffMs = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`) - Date.now();
  const days = Math.round(diffMs / 86_400_000);
  const hours = Math.round(diffMs / 3_600_000);
  const duration =
    days >= 1
      ? `${days} Days`
      : hours >= 1
        ? `${hours} Hours`
        : `${Math.round(diffMs / 60_000)} Minutes`;
  log(`[${TAG}] ✅ Subscription expires at: ${raw}`);
  return { expiresAt: raw, duration };
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

    // Step 1: Open registration page, fill form, submit
    await submitRegistration(page, { login, password, email }, log);
    log(`[${TAG}] ✅ Account registered (${login}).`);

    // Step 2: Navigate to cabinet and activate trial
    await activateTrial(page, log);

    // Step 3: Build playlist URL and extract expiry
    const tvPlaylist = `http://p.velestore.su/play/${login}/${password}/playlist.m3u8`;
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
