/**
 * SacoTV — free trial via multi-step web flow.
 * Site: https://sacotv.com
 *
 * Flow:
 *   1. GET  /register.php        → session cookies + CSRF token
 *   2. POST /register.php        → create account (sends verification email)
 *   3. Poll inbox → click verify link
 *   4. GET  /generate-trial.php  → fresh CSRF token
 *   5. POST /generate-trial.php  → claim trial (region=world)
 *   6. GET  /dashboard.php       → extract M3U link
 */
import {
  generateUsername,
  generatePassword,
  buildResult,
  nextDayAt,
} from "../../../parsing/generators.js";
import { extractPlaylists } from "../../../parsing/extractors.js";
import {
  createJar,
  get,
  post,
  extractInputValue,
  extractCsrfToken,
} from "../../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://sacotv.com";
const REGISTER = `${BASE}/register.php`;
const GENERATE = `${BASE}/generate-trial.php`;
const TAG = "SacoTV";

// SacoTV uses a non-standard "csrf" input name — try that first, then fall back.
const getCsrf = (html) =>
  extractInputValue(html, "csrf") ?? extractCsrfToken(html);

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "sacotv",
    name: TAG,
    description: "Until Midnight Next Day",
    group: "trex",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();
    const username = generateUsername();
    const password = generatePassword();

    // Step 1: Load registration page — capture session cookies + CSRF token.
    const initRes = await get(REGISTER, jar, { referer: BASE });
    const regCsrf = getCsrf(initRes.text);
    if (!regCsrf)
      throw new Error(`[${TAG}] CSRF not found on registration page.`);

    // Step 2: Submit registration form — site sends a verification email.
    log(`[${TAG}] Registering ${email}...`);
    const regRes = await post(
      REGISTER,
      jar,
      {
        csrf: regCsrf,
        website: "",
        username,
        email,
        name: username,
        password,
        password_confirm: password,
      },
      REGISTER,
    );
    log(`[${TAG}] 📦 Registration response: ${regRes.text?.slice(0, 500)}`);

    // Step 3: Poll inbox for the verification link and click it.
    log(`[${TAG}] Waiting for verification email...`);
    const verifyLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: ["sacotv", "verify"],
        pattern: /sacotv\.com\/verify\.php\?token=/i,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );
    if (!verifyLink) throw new Error(`[${TAG}] Verification email timed out.`);
    await get(verifyLink, jar, { referer: BASE });
    log(`[${TAG}] ✅ Email verified.`);

    // Step 4: Load trial-generation page to get a fresh CSRF token.
    const genPage = await get(GENERATE, jar, { referer: BASE });
    const trialCsrf = getCsrf(genPage.text);
    if (!trialCsrf) throw new Error(`[${TAG}] CSRF not found on trial page.`);

    // Step 5: Submit the trial claim — site redirects to dashboard on success.
    log(`[${TAG}] Claiming trial...`);
    const trialRes = await post(
      GENERATE,
      jar,
      { csrf: trialCsrf, region: "world" },
      GENERATE,
    );
    log(`[${TAG}] 📦 Trial response (finalUrl): ${trialRes.finalUrl}`);
    log(`[${TAG}] 📦 Trial response (body): ${trialRes.text?.slice(0, 500)}`);

    // Step 6: Load dashboard and extract M3U playlist link.
    const dashUrl = trialRes.finalUrl?.includes("dashboard.php")
      ? trialRes.finalUrl
      : `${BASE}/dashboard.php`;
    const dash = await get(dashUrl, jar, { referer: GENERATE });
    log(`[${TAG}] 📦 Dashboard response: ${dash.text?.slice(0, 1000)}`);
    const playlists = extractPlaylists(dash.text);

    if (playlists) log(`[${TAG}] ✅ M3U: ${playlists.tvPlaylist}`);
    else log(`[${TAG}] ⚠️ Trial activated but no M3U found.`, "warn");

    return buildResult({
      username,
      password,
      playlists,
      expiryDate: nextDayAt(1),
      serviceName: TAG,
    });
  },
};
