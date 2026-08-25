/**
 * TVCorn free trial registration service.
 *
 * Fills the registration form, verifies the OTP from the inbox email,
 * then extracts the M3U playlist link from the credentials page.
 */
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
import { fillInstant, clickFirst, extractM3u } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://en.tvcorn.com/trial";
const TAG = "TVCorn";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "commit", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  name: 'input[name="name"]',
  email: 'input[name="email"]',
  continueBtn: '.js-go-to-step[target-step="3"]',
  otpBox: ".otp-box",
  confirmSubmit: ".js-verify-otp",
  knowWhatImDoing: '.js-go-to-step[target-step="6"]',
  m3uTab: '.js-tab-btn[data-tab="m3u"]',
  m3uValue: ".js-val-m3u",
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvcorn",
    name: "TVCorn",
    url: TRIAL_URL,
    description: "TVCorn free trial — email OTP verification + M3U extraction",
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

    // Step 1: Fill and submit the registration form
    await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.name, { state: "visible", timeout: 10_000 })
      .catch(() => {});
    await fillInstant(page, {
      [SELECTORS.name]: username,
      [SELECTORS.email]: email,
    });
    await clickFirst(page, SELECTORS.continueBtn);

    // Step 2: Poll inbox for the OTP verification code
    await emailPage.bringToFront().catch(() => {});
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "tvcorn",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    if (!code) throw new Error("Verification code not received.");
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // Step 3: Enter OTP and confirm
    await page.bringToFront().catch(() => {});
    await fillInstant(page, { [SELECTORS.otpBox]: code });
    await clickFirst(page, SELECTORS.confirmSubmit);

    // Step 4: Dismiss the "I know what I'm doing" prompt and open the M3U tab
    await page
      .waitForSelector(SELECTORS.knowWhatImDoing, {
        state: "visible",
        timeout: 15_000,
      })
      .catch(() => {});
    await clickFirst(page, SELECTORS.knowWhatImDoing);

    await page
      .waitForSelector(SELECTORS.m3uTab, { state: "visible", timeout: 8_000 })
      .catch(() => {});
    await clickFirst(page, SELECTORS.m3uTab);

    // Step 5: Extract the M3U link (retry for up to 15 s while the page generates it)
    let m3uLink = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      m3uLink = await extractM3u(page);
      if (m3uLink) break;
      await page.waitForTimeout(300);
    }

    if (m3uLink) log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
    else log(`[${TAG}] M3U link not found on credentials page.`, "warn");

    return {
      username,
      password: null,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist: null,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: m3uLink
        ? "TVCorn trial activated successfully."
        : "Trial registered — M3U link not found on credentials page.",
    };
  },
};
