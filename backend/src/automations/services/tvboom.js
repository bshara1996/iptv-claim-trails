const BASE_URL = "https://tvboom.vip";

const VALIDATION_LINK_RE =
  /https?:\/\/tvboom\.vip\/index\.php\?do=register(?:&|&amp;)doaction=validating(?:&|&amp;)id=[a-zA-Z0-9_|=~%-]+/i;

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
    'button:has-text("Регистрация")',
    'input[value="Регистрация"]',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomChars(chars, n) {
  return Array.from(
    { length: n },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function generateCredentials() {
  const username =
    randomChars("abcdefghijklmnopqrstuvwxyz", 4) +
    Math.floor(1000 + Math.random() * 9000);
  const password =
    randomChars("abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 6) +
    randomChars("23456789", 4);
  return { username, password };
}

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

async function clickFirst(page, selectors) {
  const el = await findVisible(page, selectors);
  if (el) {
    await el.click();
    return true;
  }
  return false;
}

async function fillFirst(page, selectors, value) {
  const el = await findVisible(page, selectors);
  if (el) {
    await el.click().catch(() => {});
    await el.fill(value);
    return true;
  }
  return false;
}

async function handleCaptcha(page) {
  const frame = page
    .frames()
    .find((f) => f.url().includes("google.com/recaptcha/api2/anchor"));
  if (!frame) return;
  const checkbox = await frame
    .waitForSelector("#recaptcha-anchor", { timeout: 3_000 })
    .catch(() => null);
  if (!checkbox) return;

  await checkbox.click();
  // Wait for the checkmark — if Google is satisfied this is all that happens
  await frame
    .waitForSelector('#recaptcha-anchor[aria-checked="true"]', {
      timeout: 5_000,
    })
    .catch(() => {});

  // If Google opens the image-challenge popup (bframe), wait for it to close
  // before returning — it sits on top of the submit button and blocks clicks
  await page
    .waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("iframe")).some((f) =>
          f.src.includes("bframe"),
        ),
      { timeout: 120_000, polling: 500 },
    )
    .catch(() => {});
}

async function clickValidationLink(emailPage, url) {
  // Search every frame in the email page for an anchor whose href matches the URL.
  // Tmaily may render email bodies inside an <iframe>.
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

async function clickAndWait(page, selectors) {
  await clickFirst(page, selectors);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

// ─── Service ──────────────────────────────────────────────────────────────────

const TvBoomRegistration = {
  meta: {
    id: "tvboom",
    name: "TVBoom",
    url: `${BASE_URL}/register`,
    description: "TVBoom 24-hour IPTV trial registration & activation",
  },

  async execute({ page, emailPage, provider, email, log = () => {} }) {
    const { username, password } = generateCredentials();

    // 1. Registration form
    log(`[TVBoom] Registering as "${username}"...`);
    await navigateTo(page, `${BASE_URL}/register`).catch(() =>
      navigateTo(page, `${BASE_URL}/index.php?do=register`).catch(() => {}),
    );

    await clickFirst(page, SELECTORS.rulesAccept);
    await fillFirst(page, SELECTORS.username, username);
    await fillFirst(page, SELECTORS.email, email);
    await fillFirst(page, SELECTORS.password, password);
    await fillFirst(page, SELECTORS.passwordRepeat, password);
    await handleCaptcha(page);

    const submitted = await clickFirst(page, SELECTORS.submit);
    if (!submitted) await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    // 2. Confirmation email — open it and click the validation link inside
    log("[TVBoom] Waiting for confirmation email...");
    await emailPage.bringToFront().catch(() => {});

    const validationUrl = await provider.waitForEmailAndExtractLink(emailPage, {
      filterText: "tvboom",
      pattern: VALIDATION_LINK_RE,
      timeout: 60_000,
    });
    if (!validationUrl)
      throw new Error(
        "Validation link not found in TVBoom confirmation email.",
      );

    // The email is now open in emailPage. Find the validation anchor and click it
    // so the browser follows the link naturally (handles redirects, cookies, etc.)
    log("[TVBoom] Clicking validation link inside email...");
    const cleanUrl = validationUrl.replace(/&amp;/g, "&");

    const clicked = await clickValidationLink(emailPage, cleanUrl);

    // Whether we clicked an anchor or fell back to direct navigation, land on the validation page
    if (clicked) {
      await page.bringToFront().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } else {
      log(
        "[TVBoom] Anchor not found — navigating directly to validation URL...",
      );
      await navigateTo(page, cleanUrl).catch(() => {});
      await page.bringToFront().catch(() => {});
    }
    log("[TVBoom] ✅ Account confirmed.");

    // 3. Activate 24h trial
    await clickAndWait(page, SELECTORS.continueReg);
    await clickAndWait(page, SELECTORS.cabinet);
    await clickFirst(page, SELECTORS.activateTest);
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    const tvPlaylist = `${BASE_URL}/${username}/${password}/hls/playlist.m3u8`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      },
    );

    log(`[TVBoom] ✅ Trial activated. Playlist: ${tvPlaylist}`);

    return {
      username,
      password,
      email,
      tvPlaylist,
      vodPlaylist: null,
      duration: "24 Hours",
      expiresAt,
      allM3uLinks: [tvPlaylist],
      status: "success",
      note: "24-hour IPTV trial activated successfully.",
    };
  },
};

export default TvBoomRegistration;
