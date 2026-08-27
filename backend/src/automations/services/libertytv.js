/**
 * LibertyTV free trial registration service.
 *
 * Registers an account, verifies the email OTP, selects the Arabic Package,
 * and extracts the M3U link from the dashboard.
 */
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
import { fillInstant, clickFirst, extractM3u } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const REGISTER_URL = "https://account.libertytv.net/register.php";
const DASHBOARD_URL = "https://account.libertytv.net/dashboard.php";
const TAG = "LibertyTV";
const PASSWORD = "123456";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: 'input[name="name"]',
  email: 'input[name="email"], input[type="email"]',
  password: 'input[name="password"], input[type="password"]',
  submitBtn: 'button[type="submit"]',
  otpInput: 'input[maxlength="6"], input[name="code"], input[name="otp"]',
  regionSelect: "#trial-region",
  claimBtn: "#trial-submit",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Waits for a selector with a default timeout (never throws).
const waitFor = (page, sel, timeout = 15_000) =>
  page.waitForSelector(sel, { state: "visible", timeout }).catch(() => null);

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "libertytv",
    name: "LibertyTV",
    url: REGISTER_URL,
    description:
      "LibertyTV free trial — email OTP verification + Arabic Package + M3U extraction",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();

    // Registration
    await page.goto(REGISTER_URL, GOTO_OPTS).catch(() => {});
    await waitFor(page, SELECTORS.email);
    await fillInstant(page, {
      [SELECTORS.name]: username,
      [SELECTORS.email]: email,
      [SELECTORS.password]: PASSWORD,
    });
    await clickFirst(page, SELECTORS.submitBtn);
    log(`[${TAG}] Registration form submitted.`);

    // Email verification
    await emailPage.bringToFront().catch(() => {});
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "liberty",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });
    if (!code) throw new Error("Verification code not received.");
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // OTP submission
    await page.bringToFront().catch(() => {});
    await waitFor(page, SELECTORS.otpInput);
    await fillInstant(page, { [SELECTORS.otpInput]: code });
    await clickFirst(page, SELECTORS.submitBtn);
    log(`[${TAG}] OTP submitted.`);

    // Trial claim (Arabic Package)
    await waitFor(page, SELECTORS.regionSelect, 20_000);
    await page.selectOption(SELECTORS.regionSelect, "32");
    await clickFirst(page, SELECTORS.claimBtn);
    log(`[${TAG}] Arabic Package selected, trial claimed.`);

    // Navigate to dashboard and extract M3U
    await page.goto(DASHBOARD_URL, GOTO_OPTS).catch(() => {});
    const m3uLink = await extractM3u(page);

    if (m3uLink) log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
    else log(`[${TAG}] M3U link not found on credentials page.`, "warn");

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
        ? "LibertyTV trial activated successfully (Arabic Package)."
        : "Trial registered — M3U link not found on credentials page.",
    };
  },
};
