const BASE_URL = "https://velestore.su";
const REG_URL = `${BASE_URL}/?do=register`;
const TAG = "VeleStore";
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

const rand = (n) =>
  Array.from({ length: n }, () => CHARS[Math.floor(Math.random() * 36)]).join(
    "",
  );
const plural = (n, w) => `${n} ${w}${n !== 1 ? "s" : ""}`;

function generateCredentials() {
  return {
    login: `user${rand(8)}`,
    password: `P${rand(5)}${Math.floor(Math.random() * 90 + 10)}`,
  };
}

function formatDuration(expiryDate) {
  const mins = Math.max(0, Math.round((expiryDate - Date.now()) / 60_000));
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;

  if (hours >= 24) {
    const d = Math.floor(hours / 24),
      h = hours % 24;
    return h > 0
      ? `${plural(d, "Day")} ${plural(h, "Hour")}`
      : plural(d, "Day");
  }
  if (hours > 0)
    return rem > 0
      ? `${plural(hours, "Hour")} ${plural(rem, "Min")}`
      : plural(hours, "Hour");
  return plural(mins, "Min");
}

async function execute({ page, email, log = () => {} }) {
  const { login, password } = generateCredentials();
  log(`[${TAG}] Generated credentials — login: ${login}`);

  // 1. Open registration page
  await page
    .goto(REG_URL, { waitUntil: "domcontentloaded", timeout: 20_000 })
    .catch(() =>
      log(
        `[${TAG}] Page load timed out — proceeding with current DOM.`,
        "warn",
      ),
    );

  // 2. Fill registration form
  await page.waitForSelector("#name", { timeout: 8_000 }).catch(() => {});
  log(`[${TAG}] Filling registration form...`);
  for (const [sel, val] of [
    ["#name", login],
    ["#password1", password],
    ["#password2", password],
    ["#email", email],
  ]) {
    await page.fill(sel, val);
    await page.waitForTimeout(300);
  }
  log(`[${TAG}] Form filled: login=${login}, email=${email}`);

  // 3. Click reCAPTCHA checkbox
  log(`[${TAG}] Clicking reCAPTCHA checkbox...`);
  const anchorFrame = await page
    .waitForSelector('iframe[src*="recaptcha/api2/anchor"]', { timeout: 8_000 })
    .catch(() => null);
  const frame = anchorFrame
    ? await anchorFrame.contentFrame().catch(() => null)
    : null;
  const checkbox = frame
    ? await frame
        .waitForSelector("#recaptcha-anchor", { timeout: 5_000 })
        .catch(() => null)
    : null;

  if (checkbox) {
    await checkbox.click();
    log(`[${TAG}] reCAPTCHA checkbox clicked — waiting for user to solve...`);
  } else {
    log(`[${TAG}] reCAPTCHA not found — user must solve manually.`);
  }

  // 4. Wait for CAPTCHA solution, then submit
  await page.waitForFunction(
    () => {
      const ta = document.querySelector("textarea#g-recaptcha-response");
      return ta && ta.value.length > 0;
    },
    { timeout: 5 * 60_000, polling: 500 },
  );
  log(`[${TAG}] CAPTCHA solved — submitting form...`);

  const navPromise = page
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25_000 })
    .catch(() => {});
  await page
    .click('button[name="submit"][type="submit"]')
    .catch(() => page.click('button.btn[type="submit"]'))
    .catch(() => page.keyboard.press("Enter"));
  await navPromise;

  // 5. Check for registration errors
  const errorText = await page
    .evaluate(
      () => document.querySelector(".inform-1")?.innerText.trim() ?? null,
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

  // 6. Navigate to cabinet
  const cabinetBtn = await page
    .waitForSelector(
      'a:has-text("ПЕРЕЙТИ В КАБИНЕТ"), button:has-text("ПЕРЕЙТИ В КАБИНЕТ")',
      { timeout: 10_000 },
    )
    .catch(() => null);

  if (cabinetBtn) {
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
        .catch(() => {}),
      cabinetBtn.click(),
    ]);
    log(`[${TAG}] Cabinet URL: ${page.url()}`);

    // 7. Activate 6-hour trial
    const testBtn = await page
      .waitForSelector(
        'input[type="button"][value="Получить тест на 6 часов"]',
        { timeout: 10_000 },
      )
      .catch(() => null);

    if (testBtn) {
      await testBtn.click();
      await page.waitForTimeout(2_000);
    } else {
      log(`[${TAG}] «Получить тест на 6 часов» button not found.`, "warn");
    }
  } else {
    log(`[${TAG}] «ПЕРЕЙТИ В КАБИНЕТ» not found — continuing.`, "warn");
  }

  // 8. Build playlist URL
  const tvPlaylist = `http://p.velestore.su/play/${login}/${password}/playlist.m3u8`;
  log(`[${TAG}] Playlist URL: ${tvPlaylist}`);

  // 9. Extract expiry date
  const expiresAt = await page
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

  if (expiresAt) log(`[${TAG}] Subscription expires at: ${expiresAt}`);
  else
    log(
      `[${TAG}] Could not read expiry date — falling back to +6h estimate.`,
      "warn",
    );

  // 10. Parse expiry and calculate duration
  const match = expiresAt?.match(
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/,
  );
  let expiresAtFinal, duration;

  if (match) {
    const [, dd, mm, yyyy, hh, min] = match;
    expiresAtFinal = expiresAt;
    duration = formatDuration(new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`));
    log(`[${TAG}] Calculated duration: ${duration}`);
  } else {
    expiresAtFinal =
      expiresAt ??
      new Date(Date.now() + 6 * 36e5).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    duration = "6 Hours";
  }

  return {
    username: login,
    password,
    email,
    tvPlaylist,
    vodPlaylist: null,
    allM3uLinks: [tvPlaylist],
    duration,
    expiresAt: expiresAtFinal,
    status: "success",
    note: `VeleStore trial activated. Expires: ${expiresAtFinal}`,
  };
}

export default {
  meta: {
    id: "velestore",
    name: "VeleStore",
    url: REG_URL,
    description: "VeleStore IPTV 6-hour free trial registration",
  },
  execute,
};
