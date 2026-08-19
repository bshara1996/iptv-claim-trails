import logger from "../../logger.js";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) return el;
    } catch (_) {}
  }
  return null;
}

async function handleCaptcha(page) {
  const frame = page
    .frames()
    .find((f) => f.url().includes("google.com/recaptcha/api2/anchor"));
  if (!frame) return;
  const checkbox = await frame
    .waitForSelector("#recaptcha-anchor", { timeout: 3_000 })
    .catch(() => null);
  if (checkbox) {
    await checkbox.click();
    await frame
      .waitForSelector('#recaptcha-anchor[aria-checked="true"]', {
        timeout: 5_000,
      })
      .catch(() => {});
  }
}

async function submitForm(page, url, tag, email) {
  await page
    .goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 })
    .catch(() =>
      logger.warn(`[${tag}] Page load timeout — proceeding with current DOM.`),
    );

  await page
    .waitForSelector(EMAIL_SELECTORS[0], { timeout: 5_000 })
    .catch(() => {});

  const emailField = await findVisible(page, EMAIL_SELECTORS);
  if (!emailField)
    throw new Error(`Email field not found on the ${tag} registration page.`);

  await emailField.click().catch(() => {});
  await emailField.fill(email);
  logger.info(`[${tag}] Email filled: ${email}`);

  await handleCaptcha(page);

  logger.info(`[${tag}] Submitting form...`);
  const navPromise = page
    .waitForNavigation({ waitUntil: "load", timeout: 15_000 })
    .catch(() => {});

  const submitBtn = await findVisible(page, SUBMIT_SELECTORS);
  if (submitBtn) await submitBtn.click();
  else await page.keyboard.press("Enter");

  await navPromise;

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

  logger.info(`[${tag}] Registration submitted successfully.`);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRegistrationService({
  id,
  name,
  url,
  filterText,
  description,
}) {
  const tag = name;

  return {
    meta: { id, name, url, description },

    async execute({ page, emailPage, provider, email, log = () => {} }) {
      log(`[${tag}] Submitting registration form...`);
      await submitForm(page, url, tag, email);

      log(`[${tag}] Waiting for confirmation email with playlist links...`);
      await emailPage.bringToFront().catch(() => {});

      const playlists = await provider.waitForEmailAndExtractPlaylists(
        emailPage,
        {
          filterText,
          timeout: 120_000,
        },
      );

      if (playlists.allM3uLinks.length === 0) {
        log(`[${tag}] No M3U links found in confirmation email.`, "warn");
      }

      return {
        email,
        tvPlaylist: playlists.tvPlaylist,
        vodPlaylist: playlists.vodPlaylist,
        allM3uLinks: playlists.allM3uLinks,
        duration: playlists.duration ?? null,
        expiresAt: playlists.expiresAt ?? null,
        status: "success",
        note: playlists.tvPlaylist
          ? "M3U playlist links extracted from confirmation email."
          : "Registered — no playlist links found in confirmation email.",
      };
    },
  };
}

// ─── RU-TV service ────────────────────────────────────────────────────────────

export default createRegistrationService({
  id: "rutv",
  name: "RU-TV",
  url: "https://rg.ru-tv.site/regfm.php?devTypeID=100",
  filterText: "rutv.vip",
  description: "RU-TV IPTV free trial registration",
});
