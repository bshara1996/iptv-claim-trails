/**
 * KccCam — Full account rotation and CCCAM line renewal flow
 *
 * 1.  Read the last account from kcccam_accounts.json
 * 2.  Login to the existing (last) account
 * 3.  Generate random temp LINE credentials and apply them (liberates default creds)
 * 4.  Logout → navigate to registration page
 * 5.  Register a brand-new account
 * 6.  Login to the new account and apply the target LINE credentials
 * 7.  Save the new account to kcccam_accounts.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateUsername } from "../utils/generators.js";
import { solveImageCaptcha } from "../utils/captchaOcr.js";
import { clickFirst, fillInstant } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "KccCam";
const LOGIN_URL = "https://buy.kcccam.org/reseller/login";
const REGISTER_URL = "https://buy.kcccam.org/reseller/register";
const CCCAM_URL = "https://buy.kcccam.org/reseller/cccam";
const PASSWORD = "123456";

// Target LINE credentials written to every newly registered account
const LINE_USER = "fhggfhgfghfhgfghf";
const LINE_PASS = "12345546445";

const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 30_000 };

const ACCOUNTS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../kcccam_accounts.json",
);

// ── Selectors ─────────────────────────────────────────────────────────────────

const SEL = {
  // Login
  loginEmail: 'input[name="email"]',
  loginPass: 'input[name="pass"]',
  loginSubmit: 'input[type="submit"]',
  loginError: ".form-error",
  logoutLink: 'a[href*="/reseller/login/logout/"]',

  // Register
  regEmail: "#email",
  regUsername: "#username",
  regPassword: 'input[name="password"]',
  regPassword2: 'input[name="password2"]',
  regCheckbox: 'input[type="checkbox"]',
  regSubmit: 'input[type="submit"][name="s"]',
  regError: ".form-error-no-margin",

  // CAPTCHA (shared)
  captchaImg: 'img[src*="/captcha/"]',
  captchaInput: "#captcha-in",

  // CCCAM line management
  modalClose: 'button[data-dismiss="modal"]',
  radioPort: 'input[type="radio"][value="3|12003|0"]',
  generateBtn: "#btnd1",
  generateClose: 'button.btn-info[data-dismiss="modal"]',
  editLink: 'a[onclick*="ashan=edit"]',
  lineUser: 'input[name="lineuser"]',
  linePass: 'input[name="linepass"]',
  editSubmit: "#submitform",
  editClose: 'button.btn-default[data-dismiss="modal"]',
};

// ── Account persistence ───────────────────────────────────────────────────────

function readAccounts() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function fetchLastAccount() {
  const list = readAccounts();
  if (!list.length)
    throw new Error(`[${TAG}] kcccam_accounts.json is empty or missing.`);
  return list[list.length - 1];
}

function saveAccount(entry) {
  const list = readAccounts();
  list.push({ ...entry, savedAt: new Date().toISOString() });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2), "utf8");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const waitFor = (page, sel, timeout = 8_000) =>
  page.waitForSelector(sel, { state: "visible", timeout }).catch(() => null);

const navigate = (page, url) => page.goto(url, GOTO_OPTS).catch(() => {});
const click = (page, selector) => clickFirst(page, selector).catch(() => false);

// Returns true if the given selector's text matches the pattern.
const hasErrorText = (page, sel, re) =>
  page
    .evaluate(
      (s, r) => {
        const el = document.querySelector(s);
        return !!(el && new RegExp(r, "i").test(el.innerText));
      },
      sel,
      re.source,
    )
    .catch(() => false);

// Returns the first edit link's onclick attribute, or null.
const getEditOnclick = (page) =>
  page
    .$$eval(SEL.editLink, (els) => els[0]?.getAttribute("onclick") ?? null)
    .catch(() => null);

// Reads and validates the CAPTCHA image; returns the 4-char code or null.
async function readCaptcha(page, log) {
  const code = await solveImageCaptcha(page, SEL.captchaImg, log);
  if (/^[a-zA-Z0-9]{4}$/.test(code)) return code;
  log(`[${TAG}] CAPTCHA "${code ?? ""}" not 4 chars — retrying…`, "warn");
  return null;
}

async function submitForm(page, form, log) {
  for (let attempt = 1; ; attempt++) {
    log(`[${TAG}] ${form.label} attempt ${attempt}…`);
    await navigate(page, form.url);
    await waitFor(page, SEL.captchaImg, 15_000);

    const code = await readCaptcha(page, log);
    if (!code) continue;

    await fillInstant(page, { ...form.fields, [SEL.captchaInput]: code });
    if (form.acceptTerms)
      await page.evaluate((s) => {
        const checkbox = document.querySelector(s);
        if (checkbox && !checkbox.checked) checkbox.click();
      }, SEL.regCheckbox);

    const outcome = Promise.race([
      page.waitForNavigation(GOTO_OPTS),
      waitFor(page, form.error, 15_000),
    ]).catch(() => {});
    await page.click(form.submit).catch(() => {});
    await outcome;

    if (await hasErrorText(page, form.error, form.captchaError)) {
      log(`[${TAG}] Invalid captcha — retrying…`, "warn");
      continue;
    }
    if (page.url().includes(form.path)) {
      log(`[${TAG}] Still on ${form.path.slice(1)} — retrying…`, "warn");
      continue;
    }
    return;
  }
}

// ── Login / logout ────────────────────────────────────────────────────────────

async function login(page, email, password, log) {
  await submitForm(
    page,
    {
      url: LOGIN_URL,
      fields: { [SEL.loginEmail]: email, [SEL.loginPass]: password },
      submit: SEL.loginSubmit,
      error: SEL.loginError,
      captchaError: /invalid\s*captcha\s*code/,
      path: "/login",
      label: `Login (${email})`,
    },
    log,
  );
  log(`[${TAG}] ✅ Logged in as ${email}.`);
}

async function logout(page, log) {
  await click(page, SEL.logoutLink);
  await navigate(page, REGISTER_URL);
  log(`[${TAG}] ✅ Logged out.`);
}

// ── CCCAM line credential update ──────────────────────────────────────────────

async function updateLineCredentials(page, lineUser, linePass, log) {
  await navigate(page, CCCAM_URL);

  const modal = await waitFor(page, SEL.modalClose);
  if (modal) {
    await modal.click().catch(() => {});
    log(`[${TAG}] Tutorial modal closed.`);
  }

  await page.waitForTimeout(1_000);
  let onclick = await getEditOnclick(page);

  if (!onclick) {
    log(`[${TAG}] No line found — generating one…`);
    if (!(await click(page, SEL.radioPort))) {
      log(`[${TAG}] Port radio not found.`, "warn");
      return;
    }

    if (!(await click(page, SEL.generateBtn))) {
      log(`[${TAG}] Generate button not found.`, "warn");
      return;
    }
    log(`[${TAG}] Line generated.`);

    const close = await waitFor(page, SEL.generateClose, 10_000);
    if (close) await close.click().catch(() => {});
    await page.waitForTimeout(1_000);
    onclick = await getEditOnclick(page);
  }

  const match = onclick?.match(/ajax_request_dialog\('([^']+)'\)/);
  if (!match) {
    log(`[${TAG}] Edit link not found.`, "warn");
    return;
  }

  await page.evaluate(
    (url) => ajax_request_dialog(url),
    match[1].replace(/&amp;/g, "&"),
  ); // eslint-disable-line no-undef
  await waitFor(page, SEL.editSubmit, 10_000);
  await fillInstant(page, {
    [SEL.lineUser]: lineUser,
    [SEL.linePass]: linePass,
  });
  await page.waitForTimeout(500);
  await page.evaluate(
    (s) => document.querySelector(s)?.click(),
    SEL.editSubmit,
  );

  const editClose = await waitFor(page, SEL.editClose, 10_000);
  if (editClose) await editClose.click().catch(() => {});
  log(`[${TAG}] ✅ LINE creds updated (${lineUser} / ${linePass}).`);
}

// ── Registration ──────────────────────────────────────────────────────────────

async function register(page, email, username, log) {
  await submitForm(
    page,
    {
      url: REGISTER_URL,
      fields: {
        [SEL.regEmail]: email,
        [SEL.regUsername]: username,
        [SEL.regPassword]: PASSWORD,
        [SEL.regPassword2]: PASSWORD,
      },
      submit: SEL.regSubmit,
      error: SEL.regError,
      captchaError: /invalid\s*captcha/,
      path: "/register",
      label: `Register (${username})`,
      acceptTerms: true,
    },
    log,
  );
  log(`[${TAG}] ✅ Registered (${username}).`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "kcccam",
    name: "KccCam",
    url: REGISTER_URL,
    description: "24 Hours",
  },

  async execute({ page, log = () => {} }) {
    // Phase 1: Liberate the existing account's LINE credentials
    const lastAccount = fetchLastAccount();
    log(`[${TAG}] Last account: ${lastAccount.email}`);

    const tempUser = generateUsername();
    const tempPass = generateUsername();
    log(`[${TAG}] Temp LINE creds: ${tempUser} / ${tempPass}`);

    await login(page, lastAccount.email, lastAccount.password ?? PASSWORD, log);
    await updateLineCredentials(page, tempUser, tempPass, log);

    // Phase 2: Register a new account
    await logout(page, log);

    const newUsername = generateUsername();
    const newEmail = `${newUsername}@gmail.com`;
    log(`[${TAG}] Registering new account: ${newEmail}`);
    await register(page, newEmail, newUsername, log);
    await page.waitForTimeout(1_500);

    // Phase 3: Configure target LINE credentials on the new account
    await login(page, newEmail, PASSWORD, log);
    await updateLineCredentials(page, LINE_USER, LINE_PASS, log);

    // Phase 4: Persist and return
    saveAccount({
      username: newUsername,
      email: newEmail,
      password: PASSWORD,
      lineUser: LINE_USER,
      linePass: LINE_PASS,
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
      note: `KccCam: ${lastAccount.email} LINE creds rotated; new account ${newEmail} created.`,
    };
  },
};
