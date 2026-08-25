/**
 * KccCam — Reseller Registration, Login & Line Generation
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateUsername } from "../utils/generators.js";
import { solveImageCaptcha } from "../utils/captchaOcr.js";
import { fillInstant } from "../utils/pageUtils.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const TAG = "KccCam";
const REGISTER_URL = "https://buy.kcccam.org/reseller/register";
const LOGIN_URL = "https://buy.kcccam.org/reseller/login";
const CCCAM_URL = "https://buy.kcccam.org/reseller/cccam";
const PASSWORD = "123456";
const LINE_USER = "be123456789zz"; // change it no user with same user and password same
const LINE_PASS = "123456zx";
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 30_000 };

const ACCOUNTS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../kcccam_accounts.json",
);

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  // Register
  regEmail: "#email",
  regUsername: "#username",
  regPassword: 'input[name="password"]',
  regPassword2: 'input[name="password2"]',
  regCheckbox: 'input[type="checkbox"]',
  regSubmit: 'input[type="submit"][name="s"]',
  regError: ".form-error-no-margin",
  // Login
  loginEmail: 'input[name="email"]',
  loginPass: 'input[name="pass"]',
  loginSubmit: 'input[type="submit"]',
  loginError: ".form-error",
  // CAPTCHA (shared)
  captchaImg: 'img[src*="/captcha/"]',
  captchaInput: "#captcha-in",
  // CCcam page
  modalClose: 'button[data-dismiss="modal"]',
  radioPort: 'input[type="radio"][value="3|12003|0"]',
  generateBtn: "#btnd1",
  generateClose: 'button.btn-info[data-dismiss="modal"]',
  editLink: 'a[onclick*="ashan=edit"]',
  editSubmit: "#submitform",
  editClose: 'button.btn-default[data-dismiss="modal"]',
  lineUser: 'input[name="lineuser"]',
  linePass: 'input[name="linepass"]',
};

// ── Shared utilities ──────────────────────────────────────────────────────────

// Waits for a selector and returns the element or null (never throws).
const waitFor = (page, sel, timeout = 8_000) =>
  page.waitForSelector(sel, { state: "visible", timeout }).catch(() => null);

// ── CAPTCHA ───────────────────────────────────────────────────────────────────

// OCRs the CAPTCHA image; returns the 4-char alphanumeric code or null.
async function readCaptcha(page, log) {
  const code = await solveImageCaptcha(page, SELECTORS.captchaImg, log);
  if (/^[a-zA-Z0-9]{4}$/.test(code)) return code;
  log(
    `[${TAG}] CAPTCHA "${code ?? ""}" is not 4 characters — reloading…`,
    "warn",
  );
  return null;
}

// ── Account persistence ───────────────────────────────────────────────────────

function saveAccount(entry) {
  let accounts = [];
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    } catch (_) {}
  }
  accounts.push({ ...entry, savedAt: new Date().toISOString() });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
}

// ── Registration ──────────────────────────────────────────────────────────────

async function register(page, email, username, log) {
  let attempt = 0;
  while (true) {
    attempt++;
    log(`[${TAG}] Register attempt ${attempt}…`);

    await page.goto(REGISTER_URL, GOTO_OPTS).catch(() => {});
    await waitFor(page, SELECTORS.captchaImg, 15_000);

    const code = await readCaptcha(page, log);
    if (!code) continue;

    await fillInstant(page, {
      [SELECTORS.regEmail]: email,
      [SELECTORS.regUsername]: username,
      [SELECTORS.regPassword]: PASSWORD,
      [SELECTORS.regPassword2]: PASSWORD,
      [SELECTORS.captchaInput]: code,
    });

    // Tick the terms checkbox
    await page.evaluate((sel) => {
      const cb = document.querySelector(sel);
      if (cb && !cb.checked) cb.click();
    }, SELECTORS.regCheckbox);

    const submitted = Promise.race([
      page.waitForNavigation(GOTO_OPTS),
      waitFor(page, SELECTORS.regError, 15_000),
    ]).catch(() => {});
    await page.click(SELECTORS.regSubmit).catch(() => {});
    await submitted;

    const invalid = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        return !!(el && /invalid\s*captcha/i.test(el.innerText));
      }, SELECTORS.regError)
      .catch(() => false);

    if (invalid) {
      log(`[${TAG}] Invalid Captcha — retrying…`, "warn");
      continue;
    }
    if (page.url().includes("/register")) {
      log(`[${TAG}] Still on register page — retrying…`, "warn");
      continue;
    }

    log(`[${TAG}] ✅ Registration done.`);
    saveAccount({
      username,
      email,
      password: PASSWORD,
      lineUser: LINE_USER,
      linePass: LINE_PASS,
    });
    log(`[${TAG}] Account saved.`);
    return;
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(page, email, log) {
  let attempt = 0;
  while (true) {
    attempt++;
    log(`[${TAG}] Login attempt ${attempt}…`);

    await page.goto(LOGIN_URL, GOTO_OPTS).catch(() => {});
    await waitFor(page, SELECTORS.captchaImg, 15_000);

    const code = await readCaptcha(page, log);
    if (!code) continue;

    await fillInstant(page, {
      [SELECTORS.loginEmail]: email,
      [SELECTORS.loginPass]: PASSWORD,
      [SELECTORS.captchaInput]: code,
    });

    const submitted = Promise.race([
      page.waitForNavigation(GOTO_OPTS),
      waitFor(page, SELECTORS.loginError, 15_000),
    ]).catch(() => {});
    await page.click(SELECTORS.loginSubmit).catch(() => {});
    await submitted;

    const invalid = await page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        return !!(el && /invalid\s*captcha\s*code/i.test(el.innerText));
      }, SELECTORS.loginError)
      .catch(() => false);

    if (invalid) {
      log(`[${TAG}] Invalid captcha code — retrying…`, "warn");
      continue;
    }
    if (page.url().includes("/login")) {
      log(`[${TAG}] Still on login page — retrying…`, "warn");
      continue;
    }

    log(`[${TAG}] ✅ Login done.`);
    return;
  }
}

// ── Line generation ───────────────────────────────────────────────────────────

async function generateLine(page, log) {
  await page.goto(CCCAM_URL, GOTO_OPTS).catch(() => {});

  // Close tutorial popup
  const tutorialClose = await waitFor(page, SELECTORS.modalClose);
  if (tutorialClose) {
    await tutorialClose.click();
    log(`[${TAG}] Tutorial closed.`);
  }

  // Select port and generate
  const radio = await waitFor(page, SELECTORS.radioPort);
  if (!radio) {
    log(`[${TAG}] CCCAM 12003 radio not found.`, "warn");
    return;
  }
  await radio.click();

  const generateBtn = await waitFor(page, SELECTORS.generateBtn);
  if (!generateBtn) {
    log(`[${TAG}] Generate button not found.`, "warn");
    return;
  }
  await generateBtn.click();
  log(`[${TAG}] Line generated.`);

  // Close post-generate modal
  const generateClose = await waitFor(page, SELECTORS.generateClose, 10_000);
  if (generateClose) {
    await generateClose.click();
  }

  // Find the new line's Edit URL from the first row
  await page.waitForTimeout(1_000);
  const onclick = await page
    .$$eval(
      SELECTORS.editLink,
      (links) => links[0]?.getAttribute("onclick") ?? null,
    )
    .catch(() => null);

  const match = onclick?.match(/ajax_request_dialog\('([^']+)'\)/);
  if (!match) {
    log(`[${TAG}] Edit link not found.`, "warn");
    return;
  }

  const editUrl = match[1].replace(/&amp;/g, "&");
  await page.evaluate((url) => ajax_request_dialog(url), editUrl); // eslint-disable-line no-undef

  // Wait for the Edit popup to appear, then let it fully render
  await waitFor(page, SELECTORS.editSubmit, 10_000);
  await fillInstant(page, {
    [SELECTORS.lineUser]: LINE_USER,
    [SELECTORS.linePass]: LINE_PASS,
  });

  // Click Update — dispatch directly to handle type="Submit" capitalisation
  await page.waitForTimeout(500);
  await page.evaluate(
    (sel) => document.querySelector(sel)?.click(),
    SELECTORS.editSubmit,
  );

  const editClose = await waitFor(page, SELECTORS.editClose, 10_000);
  if (editClose) {
    await editClose.click();
  }

  log(`[${TAG}] ✅ Line updated (user=${LINE_USER}, pass=${LINE_PASS}).`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "kcccam",
    name: "KccCam",
    url: REGISTER_URL,
    description: "KccCam reseller registration + login + line generation",
  },

  async execute({ page, log = () => {} }) {
    const username = generateUsername();
    const email = `${username}@gmail.com`;

    log(`[${TAG}] Email: ${email}  Password: ${PASSWORD}`);

    await register(page, email, username, log);
    await page.waitForTimeout(1_500);
    await login(page, email, log);
    await generateLine(page, log);

    return {
      username: email,
      password: PASSWORD,
      tvPlaylist: null,
      vodPlaylist: null,
      allM3uLinks: [],
      duration: null,
      expiresAt: null,
      status: "success",
      note: `KccCam account registered. Email: ${email}`,
    };
  },
};
