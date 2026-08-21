/**
 * LayerSeven — Free Trial Registration
 *
 * Flow:
 *   1. Navigate to the sign-up page, fill the form, solve the CAPTCHA,
 *      and create the account. Password is fixed at "123456".
 *      No email verification step.
 *   2. Navigate to /checkout?free-trial=1 to request the trial.
 *   3. Navigate to /orders, click "View Accounts", and extract the M3U URL.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import { generateUsername, computeExpiresAt } from "../utils/generators.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const TAG = "LayerSeven";
const PASSWORD = "123456";
const TRIAL_HOURS = 24;

const PANEL = {
  signUp: "https://panel.layerseven.ai/sign-up",
  requestTrial: "https://panel.layerseven.ai/checkout?free-trial=1",
  orders: "https://panel.layerseven.ai/orders",
};

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  username: ['input[name="username"]', 'input[placeholder*="username" i]'],
  email: ['input[name="email"]', 'input[type="email"]'],
  password: ['input[name="password"]', 'input[type="password"]'],
  submit: ['button[type="submit"]', 'button:has-text("Create Account")'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const gotoOpts = { waitUntil: "domcontentloaded", timeout: 20_000 };

// Returns the first element from `selectors` that exists and is visible, or null.
async function findVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) return el;
    } catch (_) {}
  }
  return null;
}

// Extracts the M3U URL from the page by scanning all text for the get.php pattern.
async function extractM3uFromPage(page) {
  const text = await page
    .evaluate(() => document.body?.innerText ?? "")
    .catch(() => "");
  const match = text.match(
    /https?:\/\/[^\s]+\/get\.php\?[^\s]+type=m3u[^\s]*/i,
  );
  return match ? match[0].replace(/&amp;/g, "&") : null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "layerseven",
    name: "LayerSeven",
    url: PANEL.signUp,
    description:
      "LayerSeven 24-hour free trial — panel sign-up + M3U extraction",
  },

  async execute({ page, email, log = () => {} }) {
    const username = generateUsername();

    // ── Step 1: Fill and submit the registration form ─────────────────────────
    await page.goto(PANEL.signUp, gotoOpts).catch(() => {});
    await page
      .waitForSelector(SELECTORS.email[0], {
        timeout: 10_000,
        state: "visible",
      })
      .catch(() => {});

    for (const [sel, val] of [
      [SELECTORS.username, username],
      [SELECTORS.email, email],
      [SELECTORS.password, PASSWORD],
    ]) {
      const el = await findVisible(page, sel);
      if (el) await el.fill(val);
    }

    // Solve CAPTCHA then click "Create Account"
    await solveAndSubmit(page, {
      submitSelectors: SELECTORS.submit,
      log,
      tag: TAG,
    });
    log(`[${TAG}] ✅ Account created.`);

    // ── Step 2: Request the free trial ───────────────────────────────────────
    // Navigate directly — more reliable than clicking the link since the
    // post-registration page may vary.
    await page.goto(PANEL.requestTrial, gotoOpts).catch(() => {});

    // ── Step 3: Navigate to orders, click "View Accounts", extract M3U ───────
    await page.goto(PANEL.orders, gotoOpts).catch(() => {});

    // Click "View Accounts" to reveal the M3U link
    const viewBtn = await page
      .waitForSelector(
        'button:has-text("View Accounts"), a:has-text("View Accounts")',
        { timeout: 10_000, state: "visible" },
      )
      .catch(() => null);

    if (viewBtn) {
      await viewBtn.click();
      // Wait for the M3U cell to appear after the click
      await page
        .waitForSelector('td:has-text("get.php")', {
          timeout: 10_000,
          state: "visible",
        })
        .catch(() => {});
    }

    const m3uLink = await extractM3uFromPage(page);

    if (!m3uLink) log(`[${TAG}] M3U link not found on accounts page.`, "warn");
    else log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);

    return {
      username,
      password: PASSWORD,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist: null,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeExpiresAt(TRIAL_HOURS * 60 * 60 * 1000),
      status: "success",
      note: m3uLink
        ? "LayerSeven trial activated successfully."
        : "Trial activated — M3U link not found on accounts page.",
    };
  },
};
