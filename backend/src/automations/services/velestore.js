/**
 * VeleStore free trial registration service.
 *
 * Generates random credentials, fills the registration form, solves the reCAPTCHA,
 * navigates to the user cabinet, activates the trial, then builds the
 * playlist URL directly from the credentials (no inbox polling needed).
 */
import { solveAndSubmit } from "../utils/captcha.js";
import { generateUsername, generatePassword } from "../utils/generators.js";
import { fillFirst } from "../utils/pageUtils.js";

const BASE_URL = "https://velestore.su";
const TAG = "VeleStore";

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: "#name",
  password1: "#password1",
  password2: "#password2",
  email: "#email",
  submit: [
    'button[name="submit"][type="submit"]',
    'button.btn[type="submit"]',
    'button[type="submit"]',
    'input[type="submit"]',
  ],
  cabinet:
    'a:has-text("ПЕРЕЙТИ В КАБИНЕТ"), button:has-text("ПЕРЕЙТИ В КАБИНЕТ")',
  trialBtn: 'input[type="button"][value="Получить тест на 6 часов"]',
  errorBlock: ".inform-1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fills all registration form fields with the provided credentials
async function fillForm(page, { login, password, email }) {
  await page
    .waitForSelector(SELECTORS.name, { timeout: 8_000 })
    .catch(() => {});
  await fillFirst(page, SELECTORS.name, login);
  await fillFirst(page, SELECTORS.password1, password);
  await fillFirst(page, SELECTORS.password2, password);
  await fillFirst(page, SELECTORS.email, email);
}

// Solves the CAPTCHA, submits the form, and throws on server-side validation errors
async function submitForm(page, log) {
  // Start waiting for navigation before the submit click so we don't miss it
  const nav = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25_000 })
    .catch(() => {});

  await solveAndSubmit(page, {
    submitSelectors: SELECTORS.submit,
    log,
    tag: TAG,
  });
  await nav;

  const errorText = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.innerText.trim() ?? null,
      SELECTORS.errorBlock,
    )
    .catch(() => null);

  if (
    errorText &&
    /код безопасности|captcha|ошибка регистрации/i.test(errorText)
  )
    throw new Error(`Registration failed (captcha): ${errorText}`);
  if (errorText && /ошибка/i.test(errorText))
    throw new Error(`Registration error: ${errorText}`);
}

// Clicks "go to cabinet" then activates the trial button
async function goToCabinetAndActivate(page, log) {
  const cabinetBtn = await page
    .waitForSelector(SELECTORS.cabinet, { timeout: 10_000 })
    .catch(() => null);

  if (!cabinetBtn) {
    log(`[${TAG}] «ПЕРЕЙТИ В КАБИНЕТ» not found — continuing.`, "warn");
    return;
  }

  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => {}),
    cabinetBtn.click(),
  ]);

  const trialBtn = await page
    .waitForSelector(SELECTORS.trialBtn, { timeout: 10_000 })
    .catch(() => null);

  if (trialBtn) {
    await trialBtn.click();
    await page.waitForTimeout(2_000);
  } else {
    log(`[${TAG}] Trial button not found.`, "warn");
  }
}

// Reads the expiry date from the cabinet page and computes the remaining duration.
async function extractExpiry(page, log) {
  const raw = await page
    .evaluate(() => {
      for (const block of document.querySelectorAll("div.udtb")) {
        if (
          block.querySelector("div.udtlb")?.innerText.includes("Действует до")
        )
          return block.querySelector("font")?.innerText.trim() ?? null;
      }
      return null;
    })
    .catch(() => null);

  if (raw) log(`[${TAG}] ✅ Subscription expires at: ${raw}`);
  else log(`[${TAG}] Could not read expiry date.`, "warn");

  const match = raw?.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return { expiresAt: null, duration: null };

  const [, dd, mm, yyyy, hh, min] = match;
  const diffMs = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`) - Date.now();

  // Pick the largest unit that fits, then format natively with Intl
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
    thresholds.find(({ ms }) => diffMs >= ms) ?? thresholds.at(-1);
  const duration = rtf
    .format(Math.round(diffMs / ms), unit)
    .replace("in ", "")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { expiresAt: raw, duration };
}

// ── Service ───────────────────────────────────────────────────────────────────

const VeleStoreRegistration = {
  meta: {
    id: "velestore",
    name: "VeleStore",
    url: `${BASE_URL}/?do=register`,
    description: "VeleStore IPTV free trial registration",
  },

  async execute({ page, email, log = () => {} }) {
    const login = `user${generateUsername()}`;
    const password = generatePassword();

    // 1. Open registration page
    await page
      .goto(`${BASE_URL}/?do=register`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      })
      .catch(() =>
        log(
          `[${TAG}] Page load timed out — proceeding with current DOM.`,
          "warn",
        ),
      );

    // 2. Fill form, solve CAPTCHA, submit
    await fillForm(page, { login, password, email });
    await submitForm(page, log);

    // 3. Navigate to cabinet and activate trial
    await goToCabinetAndActivate(page, log);

    // 4. Build playlist URL
    const tvPlaylist = `http://p.velestore.su/play/${login}/${password}/playlist.m3u8`;

    // 5. Extract expiry and duration
    const { expiresAt, duration } = await extractExpiry(page, log);

    return {
      username: login,
      password,
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

export default VeleStoreRegistration;
