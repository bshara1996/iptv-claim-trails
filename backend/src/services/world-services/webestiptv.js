/**
 * WebestIPTV — WordPress OTP-based free trial.
 *
 * Site: https://webestiptv.com/portal/register/
 *
 * Flow:
 *   1. GET  /portal/register/                → session cookies + live _wpnonce
 *   2. POST /portal/register/                → register account & redirect to verify
 *   3. GET  /portal/register/?step=verify…   → verify-step _wpnonce
 *   4. Poll inbox                            → extract 6-digit OTP
 *   5. POST /portal/register/?step=verify…   → submit OTP
 *   6. GET  /portal/subscribe/               → trial claim _wpnonce
 *   7. POST /portal/wp-admin/admin-post.php  → claim 24h free trial
 *   8. Poll inbox                            → extract M3U links
 */

import { generatePhone, buildResult } from "../../parsing/generators.js";
import { createJar, get, post } from "../../http/cookieClient.js";
import { extractInputValue, plainText } from "../../parsing/extractors.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "WebestIPTV";
const TRIAL_HOURS = 24;
const PASSWORD = "123456789ghd";
const FILTER_TEXT = ["WEBESTIPTV", "webestiptv"];

const BASE_URL = "https://webestiptv.com/portal";
const REG_URL = `${BASE_URL}/register/`;
const SUB_URL = `${BASE_URL}/subscribe/`;
const TRIAL_URL = `${BASE_URL}/wp-admin/admin-post.php`;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extracts _wpnonce from hidden input or inline JS literal.
const getNonce = (html) =>
  extractInputValue(html, "_wpnonce") ??
  html.match(/["']_wpnonce["']\s*:\s*["']([a-f0-9]+)["']/i)?.[1] ??
  null;

// Extracts the verify-step redirect URL from response text or header location.
const getVerifyUrl = (html, finalUrl) =>
  finalUrl?.includes("step=verify")
    ? finalUrl
    : (html.match(
        /http-equiv=["']refresh["'][^>]*content=["'][^;]*;\s*url=([^"']+)/i,
      )?.[1] ??
      html.match(
        /window\.location(?:\.href)?\s*=\s*["']([^"']+step=verify[^"']+)["']/i,
      )?.[1] ??
      null);

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "webestiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "best",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();

    // Step 1: fetch registration page (cache-busting to bypass LiteSpeed stale nonce).
    log(`[${TAG}] 🔐 Loading registration page...`);
    const { text: regHtml } = await get(`${REG_URL}?_=${Date.now()}`, jar, {
      extraHeaders: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    const regNonce = getNonce(regHtml);
    if (!regNonce)
      throw new Error(`[${TAG}] Failed to extract registration nonce.`);

    // Step 2: submit registration and obtain verify redirect URL.
    log(`[${TAG}] 📝 Submitting registration for ${email}...`);
    const name =
      email
        .split("@")[0]
        .replace(/[^a-zA-Z]/g, "")
        .slice(0, 10) || "user";
    const {
      text: resText,
      finalUrl,
      status,
    } = await post(
      REG_URL,
      jar,
      {
        _wpnonce: regNonce,
        _wp_http_referer: new URL(REG_URL).pathname,
        webestiptv_auth_action: "register",
        ref: "",
        first_name: name,
        last_name: name,
        phone: generatePhone(),
        email: email.trim(),
        password: PASSWORD,
      },
      REG_URL,
    );

    if (status >= 400) {
      const err = resText.match(
        /class=["'][^"']*wp-die-message[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
      )?.[1];
      throw new Error(
        `[${TAG}] Registration failed (HTTP ${status})${err ? `: ${plainText(err)}` : ""}`,
      );
    }

    const verifyUrl = getVerifyUrl(resText, finalUrl);
    if (!verifyUrl?.includes("step=verify"))
      throw new Error(`[${TAG}] Registration did not redirect to verify page.`);

    const { searchParams } = new URL(verifyUrl);
    const token = searchParams.get("token");
    const auth = searchParams.get("auth") ?? "otp_sent";
    if (!token)
      throw new Error(`[${TAG}] Verify token not found in redirect URL.`);

    // Step 3: load OTP verification page to extract verify nonce.
    log(`[${TAG}] 🔐 Loading OTP verification page...`);
    const { text: verifyHtml } = await get(verifyUrl, jar, {
      referer: REG_URL,
    });
    const verifyNonce = getNonce(verifyHtml);
    if (!verifyNonce)
      throw new Error(`[${TAG}] Failed to extract verify-step nonce.`);

    // Step 4: poll inbox for 6-digit OTP code.
    log(`[${TAG}] 📬 Waiting for OTP email...`);
    const otp = await provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: FILTER_TEXT,
      seenIds: new Set(inboxSeenIds),
      codeRe: /\b(\d{6})\b/,
      timeout: 120_000,
    });
    if (!otp) throw new Error(`[${TAG}] OTP email did not arrive in time.`);
    log(`[${TAG}] 🔑 OTP received: ${otp}`);

    // Step 5: submit OTP.
    log(`[${TAG}] ✅ Submitting OTP...`);
    const { status: otpStatus } = await post(
      verifyUrl,
      jar,
      {
        _wpnonce: verifyNonce,
        _wp_http_referer: `/portal/register/?step=verify&token=${token}&auth=${auth}`,
        webestiptv_auth_action: "register_verify",
        token,
        otp_code: otp,
      },
      verifyUrl,
    );
    if (otpStatus >= 400)
      throw new Error(`[${TAG}] OTP verification failed (HTTP ${otpStatus}).`);

    // Step 6: claim free trial.
    log(`[${TAG}] 🎁 Claiming free trial...`);
    const { text: subHtml } = await get(`${SUB_URL}?_=${Date.now()}`, jar, {
      referer: `${BASE_URL}/dashboard/`,
      extraHeaders: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    const trialNonce = getNonce(subHtml);
    if (!trialNonce)
      throw new Error(`[${TAG}] Failed to extract trial claim nonce.`);

    const { status: trialStatus } = await post(
      TRIAL_URL,
      jar,
      {
        _wpnonce: trialNonce,
        _wp_http_referer: new URL(SUB_URL).pathname,
        action: "webestiptv_request_trial",
      },
      SUB_URL,
    );
    if (trialStatus >= 400)
      throw new Error(`[${TAG}] Trial claim failed (HTTP ${trialStatus}).`);

    // Step 7: poll inbox for trial confirmation & playlist.
    log(`[${TAG}] 📬 Waiting for confirmation email...`);
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    const m3u = playlists.tvPlaylist ?? playlists.allM3uLinks[0];
    if (!playlists.allM3uLinks.length) {
      log(`[${TAG}] ⚠️ No M3U links found in confirmation email.`, "warn");
    } else {
      log(`[${TAG}] ✅ 🎁 Trial activated.`);
      log(`[${TAG}] 📺 ${m3u}`);
    }

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
