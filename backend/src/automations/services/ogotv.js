/**
 * OgoTV free trial / account registration service (Ultra Fast).
 *
 * Flow:
 *   1. Navigate to https://ogotv.com/login/
 *   2. Backdate the anti-bot form timestamp (#authStartedAt) to bypass speed-check.
 *   3. Fill email and click "Продолжить" (#authSubmitBtn).
 *   4. Fill password (123456) in #authPassword and click "Создать аккаунт" (#authSubmitBtn).
 *   5. Poll inbox for 6-digit verification code.
 *   6. Fill code in #authVerificationCode and click "Подтвердить email" (#authSubmitBtn).
 *   7. Click "Попробовать бесплатно" (#trialButton).
 *   8. Wait for and extract M3U playlist from input.playlist-link-input.
 */
import { computeTrialExpiry } from "../utils/generators.js";
import { fillInstant, clickFirst, extractM3u } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const LOGIN_URL = "https://ogotv.com/login/";
const TAG = "OgoTV";
const PASSWORD = "123456";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  email: '#authEmail, input[name="email"]',
  password: '#authPassword, input[name="password"]',
  verificationCode: '#authVerificationCode, input[name="verification_code"]',
  submitBtn: '#authSubmitBtn, button[type="submit"]',
  trialBtn:
    '#trialButton, button#trialButton, button:has-text("Попробовать бесплатно")',
  playlistInput: "input.playlist-link-input, .playlist-link-input",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Backdates the anti-bot timestamp so the server timer check is immediately satisfied.
 */
async function bypassSpeedCheck(page, secondsAgo = 30) {
  await page
    .evaluate((sec) => {
      const el =
        document.getElementById("authStartedAt") ||
        document.querySelector('input[name="form_started_at"]');
      if (el) {
        const val = parseInt(el.value, 10) || Math.floor(Date.now() / 1000);
        el.value = String(val - sec);
      }
    }, secondsAgo)
    .catch(() => {});
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "ogotv",
    name: "OgoTV",
    url: LOGIN_URL,
    description: "OgoTV free trial — email verification + trial activation",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Open login page
    await page.goto(LOGIN_URL, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.email, { state: "visible", timeout: 15_000 })
      .catch(() => {});

    // Step 2: Backdate timestamp and fill email instantly
    await bypassSpeedCheck(page, 45);
    await fillInstant(page, { [SELECTORS.email]: email });
    await clickFirst(page, SELECTORS.submitBtn);
    log(`[${TAG}] Email submitted, awaiting password field.`);

    // Step 3: Wait for password input to appear, fill and submit
    await page.waitForSelector(SELECTORS.password, {
      state: "visible",
      timeout: 15_000,
    });
    await bypassSpeedCheck(page, 60);
    await fillInstant(page, { [SELECTORS.password]: PASSWORD });
    await clickFirst(page, SELECTORS.submitBtn);
    log(`[${TAG}] Password submitted, polling inbox for verification code.`);

    // Step 4: Poll inbox for verification code
    await emailPage.bringToFront().catch(() => {});
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "ogo",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    if (!code) throw new Error(`[${TAG}] Verification code not received.`);
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // Step 5: Enter verification code and confirm email
    await page.bringToFront().catch(() => {});
    await page.waitForSelector(SELECTORS.verificationCode, {
      state: "visible",
      timeout: 15_000,
    });
    await fillInstant(page, { [SELECTORS.verificationCode]: code });
    await clickFirst(page, SELECTORS.submitBtn);
    log(`[${TAG}] Verification code submitted.`);

    // Step 6: Click "Попробовать бесплатно" trial button
    log(`[${TAG}] Waiting for trial activation button...`);
    await page
      .waitForSelector(SELECTORS.trialBtn, {
        state: "visible",
        timeout: 20_000,
      })
      .catch(() => {});

    await clickFirst(page, SELECTORS.trialBtn);
    log(`[${TAG}] Clicked "Попробовать бесплатно".`);

    // Step 7: Wait for playlist link to be populated in input.playlist-link-input
    await page
      .waitForFunction(
        (sel) => {
          const el = document.querySelector(sel);
          return Boolean(el && el.value && el.value.trim().length > 0);
        },
        SELECTORS.playlistInput,
        { timeout: 25_000 },
      )
      .catch(() => {});

    let m3uLink = await page
      .evaluate((sel) => {
        const input = document.querySelector(sel);
        return input?.value?.trim() || null;
      }, SELECTORS.playlistInput)
      .catch(() => null);

    if (!m3uLink) {
      m3uLink = await extractM3u(page);
    }

    let parsedUser = email;
    let parsedPass = PASSWORD;
    let vodPlaylist = null;

    if (m3uLink) {
      log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
      const credMatch = m3uLink.match(/\/playlist\/([^/]+)\/([^/]+)\//);
      if (credMatch) {
        parsedUser = credMatch[1];
        parsedPass = credMatch[2];
        vodPlaylist = `https://p.rapidnas.org/vod/${parsedUser}/${parsedPass}/a/p.m3u8`;
      }
    } else {
      log(`[${TAG}] M3U playlist link not found.`, "warn");
    }

    return {
      username: parsedUser,
      password: parsedPass,
      email,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist,
      allM3uLinks: [m3uLink, vodPlaylist].filter(Boolean),
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: m3uLink
        ? "OgoTV 24-hour free trial activated successfully."
        : "OgoTV account registered — M3U link not found.",
    };
  },
};
