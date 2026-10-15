/**
 * SacoTV — free trial via multi-step web flow.
 *
 * Site: https://sacotv.com
 *
 * Flow:
 *   1. GET  /register.php          → session cookies + CSRF token
 *   2. POST /register.php          → create account (sends verification email)
 *   3. Poll inbox → GET verify link (/verify.php?token=…) → confirm account
 *   4. GET  /generate-trial.php    → fetch CSRF token for trial claim
 *   5. POST /generate-trial.php    → claim the trial (region=world)
 *   6. GET  /dashboard.php?trial_ok=… → extract M3U playlist link
 *
 * Trial duration: 24 hours.
 */
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../../../parsing/generators.js";
import { extractLinks } from "../../../parsing/extractors.js";
import {
  createJar,
  get,
  post,
  mergeCookies,
  extractCsrfToken,
  extractInputValue,
} from "../../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://sacotv.com";
const REGISTER_URL = `${BASE_URL}/register.php`;
const GENERATE_URL = `${BASE_URL}/generate-trial.php`;
const TAG = "SacoTV";
const TRIAL_HOURS = 24;
const FILTER_TEXT = ["sacotv", "verify"];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extracts a CSRF token from SacoTV's hidden input named "csrf".
function extractSacoCsrf(html) {
  return extractInputValue(html, "csrf") ?? extractCsrfToken(html) ?? null;
}

// Extracts an M3U link from the dashboard HTML.
// SacoTV typically embeds it in a data-clipboard-text attribute or as a bare URL.
function extractM3uFromDashboard(html) {
  // data-clipboard-text="http://…/get.php?username=…&password=…&type=m3u_plus"
  const clipMatch = html.match(
    /data-clipboard-text=["']([^"']*(?:get\.php|type=m3u|\.m3u)[^"']*)/i,
  );
  if (clipMatch) return clipMatch[1];

  // href with get.php or m3u param
  const hrefMatch = html.match(
    /href=["']([^"']*(?:get\.php\?[^"']*type=m3u|\.m3u8?)[^"']*)/i,
  );
  if (hrefMatch) return hrefMatch[1];

  // bare URL containing get.php?username=…&password=…&type=m3u
  const bareMatch = html.match(
    /https?:\/\/[^\s"'<>]*get\.php\?[^\s"'<>]*type=m3u[^\s"'<>]*/i,
  );
  return bareMatch ? bareMatch[0] : null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "sacotv",
    name: TAG,
    description: "Limited",
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

    // ── Step 1: Load registration page — capture session cookies + CSRF ───────
    log(`[${TAG}] 📄 Loading registration page...`);
    const initRes = await get(REGISTER_URL, jar, { referer: BASE_URL });
    if (initRes.status >= 400)
      throw new Error(
        `[${TAG}] Failed to load registration page (HTTP ${initRes.status}).`,
      );
    const csrf = extractSacoCsrf(initRes.text);
    if (!csrf)
      throw new Error(
        `[${TAG}] Could not extract CSRF token from registration page.`,
      );

    // ── Step 2: Submit registration form ──────────────────────────────────────
    log(`[${TAG}] 📝 Registering account for ${email}...`);
    const regRes = await post(
      REGISTER_URL,
      jar,
      {
        csrf,
        website: "",
        username,
        email,
        name: username,
        password,
        password_confirm: password,
      },
      REGISTER_URL,
    );
    // The site redirects to a "check your email" page or returns success HTML.
    // A 200 or 302 are both acceptable here; we just need no hard error.
    if (regRes.status >= 500)
      throw new Error(
        `[${TAG}] Registration request failed (HTTP ${regRes.status}).`,
      );
    log(
      `[${TAG}] ✅ Registration submitted — waiting for verification email...`,
    );

    // ── Step 3: Poll inbox for verification link ───────────────────────────────
    const verifyLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        pattern: /sacotv\.com\/verify\.php\?token=/i,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );
    if (!verifyLink)
      throw new Error(`[${TAG}] Verification email did not arrive in time.`);
    log(`[${TAG}] 🔗 Clicking verification link...`);
    const verifyRes = await get(verifyLink, jar, { referer: BASE_URL });
    if (verifyRes.status >= 400)
      throw new Error(
        `[${TAG}] Email verification failed (HTTP ${verifyRes.status}).`,
      );
    log(`[${TAG}] ✅ Email verified.`);

    // ── Step 4: Load trial-generation page to get a fresh CSRF token ──────────
    log(`[${TAG}] 📄 Loading trial generation page...`);
    const genPageRes = await get(GENERATE_URL, jar, { referer: BASE_URL });
    if (genPageRes.status >= 400)
      throw new Error(
        `[${TAG}] Failed to load trial page (HTTP ${genPageRes.status}).`,
      );
    const trialCsrf = extractSacoCsrf(genPageRes.text);
    if (!trialCsrf)
      throw new Error(`[${TAG}] Could not extract CSRF token from trial page.`);

    // ── Step 5: Submit the trial claim ────────────────────────────────────────
    log(`[${TAG}] 🎁 Claiming trial (region: world)...`);
    const trialRes = await post(
      GENERATE_URL,
      jar,
      { csrf: trialCsrf, region: "world" },
      GENERATE_URL,
    );
    if (trialRes.status >= 500)
      throw new Error(
        `[${TAG}] Trial claim request failed (HTTP ${trialRes.status}).`,
      );

    // The response redirects to /dashboard.php?trial_ok=t_… — finalUrl carries it.
    const dashUrl = trialRes.finalUrl?.includes("dashboard.php")
      ? trialRes.finalUrl
      : `${BASE_URL}/dashboard.php`;

    // ── Step 6: Load dashboard and extract M3U link ───────────────────────────
    log(`[${TAG}] 📡 Fetching dashboard for M3U link...`);
    const dashRes = await get(dashUrl, jar, { referer: GENERATE_URL });
    if (dashRes.status >= 400)
      throw new Error(
        `[${TAG}] Failed to load dashboard (HTTP ${dashRes.status}).`,
      );

    const m3uLink = extractM3uFromDashboard(dashRes.text);
    if (m3uLink) log(`[${TAG}] ✅ 🎁 Trial activated. 📺 M3U: ${m3uLink}`);
    else
      log(
        `[${TAG}] ⚠️ Trial activated but no M3U link found in dashboard.`,
        "warn",
      );

    return buildResult({
      username,
      password,
      tvPlaylist: m3uLink,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
