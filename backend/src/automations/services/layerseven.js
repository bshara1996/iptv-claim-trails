/**
 * LayerSeven — Free Trial Registration
 *
 * Flow:
 *   1. Navigate to the sign-up page, fill the form, solve the CAPTCHA,
 *      and create the account. Password is fixed at "123456".
 *      No email verification step.
 *   2. Navigate to /checkout?free-trial=1 to request the trial.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
import { fillInstant, extractM3u } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "LayerSeven";
const PASSWORD = "123456";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

const PANEL = {
  signUp: "https://panel.layerseven.ai/sign-up",
  requestTrial: "https://panel.layerseven.ai/checkout?free-trial=1",
};

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  email: "#email",
  password: "#password",
  submit: 'button[type="submit"]:has-text("Create account")',
  viewAccounts: 'button:has-text("View Accounts"), a:has-text("View Accounts")',
  m3uCell: 'td:has-text("get.php")',
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "layerseven",
    name: "LayerSeven",
    url: PANEL.signUp,
    description: "24 Hours",
  },

  async execute({ page, email, log = () => {} }) {
    // The panel uses email as the account identity; username is for the result record only.
    const username = generateUsername();
    const resolvedEmail = email ?? `${generateUsername()}@gmail.com`;

    // Step 1: Fill and submit the registration form
    await page.goto(PANEL.signUp, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.email, { state: "visible", timeout: 10_000 })
      .catch(() => {});
    await fillInstant(page, {
      [SELECTORS.email]: resolvedEmail,
      [SELECTORS.password]: PASSWORD,
    });

    // Solve CAPTCHA then click "Create account"
    await solveAndSubmit(page, {
      submitSelectors: SELECTORS.submit,
      log,
      tag: TAG,
    });
    log(`[${TAG}] ✅ Account created.`);

    // Step 2: Request the free trial
    await page.goto(PANEL.requestTrial, GOTO_OPTS).catch(() => {});

    // Click "View Accounts" to reveal the M3U link
    const viewBtn = await page
      .waitForSelector(SELECTORS.viewAccounts, {
        state: "visible",
        timeout: 10_000,
      })
      .catch(() => null);

    if (viewBtn) {
      await viewBtn.click();
      // Wait for the M3U cell to appear after the click
      await page
        .waitForSelector(SELECTORS.m3uCell, {
          state: "visible",
          timeout: 10_000,
        })
        .catch(() => {});
    }

    const m3uLink = await extractM3u(page);

    if (m3uLink) log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
    else log(`[${TAG}] M3U link not found on accounts page.`, "warn");

    return {
      username,
      password: PASSWORD,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist: null,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: m3uLink
        ? "LayerSeven trial activated successfully."
        : "Trial activated — M3U link not found on accounts page.",
    };
  },
};
