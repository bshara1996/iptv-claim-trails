/**
 * tvcorn free trial registration service.
 *
 * Flow:
 *   1. Navigate to https://en.tvcorn.com/trial
 *   2. Fill registration form (name, email) and click "Continue".
 *   3. Poll inbox for the verification email and extract the OTP code.
 *   4. Stop inbox polling immediately upon receiving the code.
 *   5. Enter verification code at once on tvcorn and click "Confirm & Start".
 *   6. Click "I know what I'm doing" button (.js-go-to-step[target-step="6"]).
 *   7. Click "M3U" tab button (.js-tab-btn[data-tab="m3u"]).
 *   8. Extract the generated M3U playlist link (.js-val-m3u / page content).
 */
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
import { fillFirst, clickFirst } from "../utils/pageUtils.js";
import { extractPlaylists } from "../inbox/index.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://en.tvcorn.com/trial";
const TAG = "tvcorn";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors (mapped directly from live DOM) ─────────────────────────────────

const SELECTORS = {
  name: 'input[name="name"]',
  email: 'input[name="email"]',
  continue: ['.js-go-to-step[target-step="3"]', 'button:has-text("Continue")'],
  otpBox: ".otp-box",
  confirmSubmit: [".js-verify-otp", 'button:has-text("Confirm & Start")'],
  knowWhatImDoing: '.js-go-to-step[target-step="6"]',
  m3uTab: '.js-tab-btn[data-tab="m3u"]',
  m3uValue: ".js-val-m3u",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the M3U URL from the page via .js-val-m3u or full page scan.
 */
async function extractM3uFromPage(page) {
  const directM3u = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.innerText?.trim() ?? "",
      SELECTORS.m3uValue,
    )
    .catch(() => "");

  if (directM3u && directM3u !== "--" && /https?:\/\//i.test(directM3u)) {
    return directM3u;
  }

  const content = await page
    .evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll("input, textarea"),
      ).map((el) => el.value);
      return `${inputs.join("\n")}\n${document.body?.innerText ?? ""}\n${document.body?.innerHTML ?? ""}`;
    })
    .catch(() => "");

  return extractPlaylists(content)?.tvPlaylist ?? null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvcorn",
    name: "tvcorn",
    url: TRIAL_URL,
    description: "tvcorn free trial — email verification code + M3U extraction",
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

    // 1. Open trial registration page
    log(`[${TAG}] Navigating to ${TRIAL_URL}...`);
    await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.name, { timeout: 10_000, state: "visible" })
      .catch(() => {});

    // 2. Fill registration form and submit
    log(`[${TAG}] Submitting registration form (name: ${username})...`);
    await fillFirst(page, SELECTORS.name, username);
    await fillFirst(page, SELECTORS.email, email);
    await clickFirst(page, SELECTORS.continue);
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    // 3. Poll inbox for verification email (stops inbox polling once received)
    await emailPage.bringToFront().catch(() => {});
    log(`[${TAG}] Waiting for verification code email...`);

    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    if (!code) {
      throw new Error(`[${TAG}] Verification code not received.`);
    }
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // 4. Enter verification code on tvcorn at once and submit
    await page.bringToFront().catch(() => {});
    await fillFirst(page, SELECTORS.otpBox, code);
    log(`[${TAG}] Submitting verification code (Confirm & Start)...`);
    await clickFirst(page, SELECTORS.confirmSubmit);

    // 5. Click "I know what I'm doing" button
    log(`[${TAG}] Waiting for account credentials...`);
    await page
      .waitForSelector(SELECTORS.knowWhatImDoing, {
        timeout: 15_000,
        state: "visible",
      })
      .catch(() => {});
    await clickFirst(page, SELECTORS.knowWhatImDoing);

    // 6. Click M3U tab button (.js-tab-btn[data-tab="m3u"])
    log(`[${TAG}] Selecting M3U tab...`);
    await page
      .waitForSelector(SELECTORS.m3uTab, { timeout: 8_000, state: "visible" })
      .catch(() => {});
    await clickFirst(page, SELECTORS.m3uTab);

    // 7. Extract generated M3U playlist link from the account page
    log(`[${TAG}] Extracting M3U playlist link...`);
    let m3uLink = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      m3uLink = await extractM3uFromPage(page);
      if (m3uLink) break;
      await page.waitForTimeout(300);
    }

    if (m3uLink) log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
    else log(`[${TAG}] M3U link not found on account page.`, "warn");

    // 8. Return formatted result
    const expiresAt = computeTrialExpiry(TRIAL_HOURS);

    return {
      username,
      password: null,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist: null,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt,
      status: "success",
      note: m3uLink
        ? "tvcorn trial activated successfully."
        : "Trial registered — M3U link not found on credentials page.",
    };
  },
};
