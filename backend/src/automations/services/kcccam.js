/**
 * KccCam — Full 10-step account flow
 *
 * 1.  Read the last account from kcccam_accounts.json
 * 2.  Login to the existing (last) account
 * 3.  Generate a random LINE_USER / LINE_PASS (once, reused throughout)
 * 4.  Update LINE credentials on the existing account
 * 5.  Logout
 * 6.  Navigate to the registration page
 * 7.  Register a brand-new account
 * 8.  Login to the new account
 * 9.  Update LINE credentials on the new account with the hardcoded values
 * 10. Save the new account to kcccam_accounts.json
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

// Fixed LINE credentials assigned to every newly registered account (step 9)
const NEW_ACCOUNT_LINE_USER = "fhggfhgfghfhgfghf";
const NEW_ACCOUNT_LINE_PASS = "12345546445";

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
  logoutLink: 'a[href*="/reseller/login/logout/"]',
};

// ── Shared utilities ──────────────────────────────────────────────────────────

const waitFor = (page, sel, timeout = 8_000) =>
  page.waitForSelector(sel, { state: "visible", timeout }).catch(() => null);

// ── CAPTCHA ───────────────────────────────────────────────────────────────────

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

function readAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch (_) {
    return [];
  }
}

function saveAccount(entry) {
  const accounts = readAccounts();
  accounts.push({ ...entry, savedAt: new Date().toISOString() });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf8");
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function login(page, email, password, log) {
  let attempt = 0;
  while (true) {
    attempt++;
    log(`[${TAG}] Login attempt ${attempt} for ${email}…`);

    await page.goto(LOGIN_URL, GOTO_OPTS).catch(() => {});
    await waitFor(page, SELECTORS.captchaImg, 15_000);

    const code = await readCaptcha(page, log);
    if (!code) continue;

    await fillInstant(page, {
      [SELECTORS.loginEmail]: email,
      [SELECTORS.loginPass]: password,
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

    log(`[${TAG}] ✅ Login succeeded for ${email}.`);
    return;
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────

async function logout(page, log) {
  // Click logout (fire-and-forget) then immediately navigate to register.
  // Avoids waiting for the logout redirect which can take 30 s.
  const link = await page.$(SELECTORS.logoutLink).catch(() => null);
  if (link) {
    await link.click().catch(() => {});
  }

  // Go straight to register — the server will have already invalidated the
  // session by the time this request lands.
  await page.goto(REGISTER_URL, GOTO_OPTS).catch(() => {});
  log(`[${TAG}] ✅ Logged out → navigated to registration page.`);
}

// ── Registration ──────────────────────────────────────────────────────────────

async function register(page, email, username, log) {
  let attempt = 0;
  while (true) {
    attempt++;
    log(`[${TAG}] Register attempt ${attempt} (${username})…`);

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

    log(`[${TAG}] ✅ Registration done (${username}).`);
    return;
  }
}

// ── Update LINE credentials ───────────────────────────────────────────────────

async function updateLineCredentials(page, lineUser, linePass, log) {
  await page.goto(CCCAM_URL, GOTO_OPTS).catch(() => {});

  // Close tutorial/welcome popup if present
  const tutorialClose = await waitFor(page, SELECTORS.modalClose);
  if (tutorialClose) {
    await tutorialClose.click();
    log(`[${TAG}] Tutorial modal closed.`);
  }

  // Find the first line's Edit link
  await page.waitForTimeout(1_000);
  const onclick = await page
    .$$eval(
      SELECTORS.editLink,
      (links) => links[0]?.getAttribute("onclick") ?? null,
    )
    .catch(() => null);

  if (!onclick) {
    // No existing line — generate one first, then edit it
    log(`[${TAG}] No existing line found; generating one…`);

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

    const generateClose = await waitFor(page, SELECTORS.generateClose, 10_000);
    if (generateClose) await generateClose.click();

    await page.waitForTimeout(1_000);
  }

  // Re-fetch the edit link (covers both "line already existed" and "just generated" cases)
  const onclickFinal = await page
    .$$eval(
      SELECTORS.editLink,
      (links) => links[0]?.getAttribute("onclick") ?? null,
    )
    .catch(() => null);

  const match = onclickFinal?.match(/ajax_request_dialog\('([^']+)'\)/);
  if (!match) {
    log(`[${TAG}] Edit link not found after generation.`, "warn");
    return;
  }

  const editUrl = match[1].replace(/&amp;/g, "&");
  await page.evaluate((url) => ajax_request_dialog(url), editUrl); // eslint-disable-line no-undef

  await waitFor(page, SELECTORS.editSubmit, 10_000);
  await fillInstant(page, {
    [SELECTORS.lineUser]: lineUser,
    [SELECTORS.linePass]: linePass,
  });

  await page.waitForTimeout(500);
  await page.evaluate(
    (sel) => document.querySelector(sel)?.click(),
    SELECTORS.editSubmit,
  );

  const editClose = await waitFor(page, SELECTORS.editClose, 10_000);
  if (editClose) await editClose.click();

  log(
    `[${TAG}] ✅ LINE credentials updated (user=${lineUser}, pass=${linePass}).`,
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "kcccam",
    name: "KccCam",
    url: REGISTER_URL,
    description: "KccCam reseller — full 10-step account rotation flow",
  },

  async execute({ page, log = () => {} }) {
    // ── Step 1: Read the last account ────────────────────────────────────────
    const accounts = readAccounts();
    if (accounts.length === 0) {
      throw new Error(
        `[${TAG}] kcccam_accounts.json is empty or missing — cannot continue.`,
      );
    }
    const lastAccount = accounts[accounts.length - 1];
    log(`[${TAG}] Last account: ${lastAccount.email}`);

    // ── Step 3: Generate random LINE credentials ONCE ────────────────────────
    // Generated here so they are reused for step 4 (existing account update).
    const tempLineUser = generateUsername();
    const tempLinePass = generateUsername();
    log(
      `[${TAG}] Generated temp LINE creds — user: ${tempLineUser}, pass: ${tempLinePass}`,
    );

    // ── Step 2: Login to the existing (last) account ─────────────────────────
    log(`[${TAG}] ── Step 2: Login to existing account ──`);
    await login(page, lastAccount.email, lastAccount.password ?? PASSWORD, log);

    // ── Step 4: Update LINE credentials on the existing account ─────────────
    log(`[${TAG}] ── Step 4: Update LINE creds on existing account ──`);
    await updateLineCredentials(page, tempLineUser, tempLinePass, log);

    // ── Step 5: Logout ───────────────────────────────────────────────────────
    log(`[${TAG}] ── Step 5: Logout ──`);
    await logout(page, log);

    // ── Steps 6 & 7: Register a brand-new account ────────────────────────────
    const newUsername = generateUsername();
    const newEmail = `${newUsername}@gmail.com`;
    log(`[${TAG}] ── Step 7: Registering new account ${newEmail} ──`);
    await register(page, newEmail, newUsername, log);
    await page.waitForTimeout(1_500);

    // ── Step 8: Login to the new account ────────────────────────────────────
    log(`[${TAG}] ── Step 8: Login to new account ──`);
    await login(page, newEmail, PASSWORD, log);

    // ── Step 9: Update LINE credentials on the new account (hardcoded) ──────
    log(`[${TAG}] ── Step 9: Update LINE creds on new account ──`);
    await updateLineCredentials(
      page,
      NEW_ACCOUNT_LINE_USER,
      NEW_ACCOUNT_LINE_PASS,
      log,
    );

    // ── Step 10: Save the new account ────────────────────────────────────────
    log(`[${TAG}] ── Step 10: Saving new account ──`);
    saveAccount({
      username: newUsername,
      email: newEmail,
      password: PASSWORD,
      lineUser: NEW_ACCOUNT_LINE_USER,
      linePass: NEW_ACCOUNT_LINE_PASS,
    });
    log(`[${TAG}] ✅ New account saved: ${newEmail}`);

    return {
      username: newEmail,
      password: PASSWORD,
      tvPlaylist: null,
      vodPlaylist: null,
      allM3uLinks: [],
      duration: null,
      expiresAt: null,
      status: "success",
      note: `KccCam: existing account ${lastAccount.email} LINE creds rotated; new account ${newEmail} created.`,
    };
  },
};
