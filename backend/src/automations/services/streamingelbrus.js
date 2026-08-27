/**
 * Yosso TV (StreamingElbrus) — Free Trial Registration
 *
 * Fills the registration form (with reCAPTCHA), clicks the agreement checkboxes,
 * submits, then polls the inbox for the verification link and navigates to it.
 * Playlists are constructed directly from the username and fixed password.
 */
import { solveAndSubmit } from "../utils/captcha.js";
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
import { fillInstant } from "../utils/pageUtils.js";

// ── Config ────────────────────────────────────────────────────────────────────

const REGISTER_URL = "https://streaming-elbrus.su/register";
const TAG = "YossoTV";
const PASSWORD = "123456";
const TRIAL_HOURS = 24;
const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// ── Selectors ─────────────────────────────────────────────────────────────────

const SELECTORS = {
  login: "#regLogin",
  email: "#regEmail",
  password: "#regPassword",
  password2: "#regPassword2",
  agree1: "#agreePrivacy",
  agree2: "#agreeTerms",
  submit: "#regBtn",
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "streamingelbrus",
    name: "Yosso TV",
    url: REGISTER_URL,
    description: "Yosso TV registration — reCAPTCHA + email link verification",
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

    // Step 1: Fill the registration form
    await page.goto(REGISTER_URL, GOTO_OPTS).catch(() => {});
    await page
      .waitForSelector(SELECTORS.login, { state: "visible", timeout: 15_000 })
      .catch(() => {});

    await fillInstant(page, {
      [SELECTORS.login]: username,
      [SELECTORS.email]: email,
      [SELECTORS.password]: PASSWORD,
      [SELECTORS.password2]: PASSWORD,
    });

    await page.check(SELECTORS.agree1).catch(() => {});
    await page.check(SELECTORS.agree2).catch(() => {});

    // Step 2: Solve reCAPTCHA and submit
    await solveAndSubmit(page, {
      submitSelectors: SELECTORS.submit,
      log,
      tag: TAG,
    });
    log(`[${TAG}] Registration submitted.`);

    // Step 3: Poll inbox for the verification link
    await emailPage.bringToFront().catch(() => {});
    const verifyLink = await provider.waitForEmailAndExtractLink(emailPage, {
      filterText: "elbrus",
      pattern: /\/verify_email\?token=/,
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    if (!verifyLink) throw new Error("Verification email not received.");
    log(`[${TAG}] ✅ Verification link received.`);

    // Step 4: Navigate to the verification link
    await page.bringToFront().catch(() => {});
    await page.goto(verifyLink, GOTO_OPTS).catch(() => {});
    log(`[${TAG}] ✅ Email verified.`);

    // Step 5: Build playlists from credentials
    const tvPlaylist = `https://p.rapidnas.org/playlist/${username}/${PASSWORD}/playlist.m3u8`;
    const vodPlaylist = `https://p.rapidnas.org/vod/${username}/${PASSWORD}/a/p.m3u8`;

    log(`[${TAG}] ✅ Playlists ready.`);

    return {
      username,
      password: PASSWORD,
      tvPlaylist,
      vodPlaylist,
      allM3uLinks: [tvPlaylist, vodPlaylist],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: "Yosso TV account registered and email verified.",
    };
  },
};
