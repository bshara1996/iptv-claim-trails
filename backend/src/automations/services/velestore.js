import { solveAndSubmit } from "../captcha.js";

const BASE_URL = "https://velestore.su";
const TAG = "VeleStore";
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// ─── Selectors ────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rand = (n) =>
  Array.from(
    { length: n },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");

async function fillForm(page, { login, password, email }, log) {
  await page
    .waitForSelector(SELECTORS.name, { timeout: 8_000 })
    .catch(() => {});
  log(`[${TAG}] Filling registration form...`);
  for (const [sel, val] of [
    [SELECTORS.name, login],
    [SELECTORS.password1, password],
    [SELECTORS.password2, password],
    [SELECTORS.email, email],
  ]) {
    await page.fill(sel, val);
    await page.waitForTimeout(300);
  }
}

async function submitForm(page, log) {
  const nav = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25_000 })
    .catch(() => {});

  // Solve CAPTCHA then immediately click submit
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

  log(`[${TAG}] Registration submitted. URL: ${page.url()}`);
}

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
  log(`[${TAG}] Cabinet URL: ${page.url()}`);

  const trialBtn = await page
    .waitForSelector(SELECTORS.trialBtn, { timeout: 10_000 })
    .catch(() => null);
  if (trialBtn) {
    await trialBtn.click();
    await page.waitForTimeout(2_000);
  } else log(`[${TAG}] «Получить тест на 6 часов» button not found.`, "warn");
}

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

  if (raw) log(`[${TAG}] Subscription expires at: ${raw}`);
  else
    log(
      `[${TAG}] Could not read expiry date — falling back to +6h estimate.`,
      "warn",
    );

  const match = raw?.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (match) {
    const [, dd, mm, yyyy, hh, min] = match;
    const ms = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`) - Date.now();
    const total = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(total / 60),
      m = total % 60,
      d = Math.floor(h / 24),
      hr = h % 24;
    const p = (n, w) => `${n} ${w}${n !== 1 ? "s" : ""}`;
    const duration =
      h >= 24
        ? hr > 0
          ? `${p(d, "Day")} ${p(hr, "Hour")}`
          : p(d, "Day")
        : h > 0
          ? m > 0
            ? `${p(h, "Hour")} ${p(m, "Min")}`
            : p(h, "Hour")
          : p(total, "Min");
    log(`[${TAG}] Calculated duration: ${duration}`);
    return { expiresAt: raw, duration };
  }

  return {
    expiresAt:
      raw ??
      new Date(Date.now() + 6 * 36e5).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
    duration: "6 Hours",
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

const VeleStoreRegistration = {
  meta: {
    id: "velestore",
    name: "VeleStore",
    url: `${BASE_URL}/?do=register`,
    description: "VeleStore IPTV 6-hour free trial registration",
  },

  async execute({ page, email, log = () => {} }) {
    const login = `user${rand(8)}`;
    const password = `P${rand(5)}${Math.floor(Math.random() * 90 + 10)}`;
    log(`[${TAG}] Generated credentials — login: ${login}`);

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
    await fillForm(page, { login, password, email }, log);
    await submitForm(page, log);

    // 3. Navigate to cabinet and activate 6-hour trial
    await goToCabinetAndActivate(page, log);

    // 4. Build playlist URL
    const tvPlaylist = `http://p.velestore.su/play/${login}/${password}/playlist.m3u8`;
    log(`[${TAG}] Playlist URL: ${tvPlaylist}`);

    // 5. Extract expiry and duration
    const { expiresAt, duration } = await extractExpiry(page, log);

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

export default VeleStoreRegistration;
