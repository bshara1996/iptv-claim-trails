/**
 * VibeFlix TV — free trial via email verification (Cloudflare Turnstile protected).
 *
 * Site: https://vibeflixtv.com/tv/iptv-free-trial/
 *
 * Flow:
 *   1. POST /wp-json/vibeflix/v1/send-verification
 *        → submits name + email + device + region + Turnstile token + timing field.
 *        → server returns { status: "success" } and sends a 6-digit code to the email.
 *   2. Poll inbox → wait for the 6-digit code.
 *   3. POST /wp-json/vibeflix/v1/verify-and-create-trial
 *        → submits name + email + code + device + region.
 *        → server returns { status: "success", username, ... }.
 *
 * Trial duration: 24 hours.
 */

import { generateUsername, buildResult } from "../../parsing/generators.js";
import {
  extractPlaylists,
  extractCredsFromM3u,
} from "../../parsing/extractors.js";
import { DEFAULT_UA } from "../../http/cookieClient.js";
import { awaitCaptcha } from "../../engine/captcha.js";

// ── Config ────────────────────────────────────────────────────────────────────

const PAGE_URL = "https://vibeflixtv.com/tv/iptv-free-trial/";
const API_BASE = "https://wp.vibeflixtv.com/wp-json/vibeflix/v1";
const SEND_URL = `${API_BASE}/send-verification`;
const VERIFY_URL = `${API_BASE}/verify-and-create-trial`;
const TURNSTILE_SITEKEY = "0x4AAAAAACD1HWWsBClHn5tU";
const TAG = "VibeFlix TV";
const SENDER_VERIFICATION = "Your VibeFlix TV Verification Code";
const SENDER_CREDENTIALS = "Your VibeFlix TV Free Trial is Active!";
const TRIAL_HOURS = 4; // actual trial length returned by the server

// Matches the credentials email — looks for the M3U playlist URL line.
const CREDENTIALS_RE = /get\.php\?username=[^&"'\s]+&(?:amp;)?password=/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

// POSTs JSON to a VibeFlix API endpoint and returns { status, raw, json }.
async function vibePost(url, body, log, label) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, */*;q=0.8",
      "User-Agent": DEFAULT_UA,
      Origin: "https://vibeflixtv.com",
      Referer: PAGE_URL,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await res.text();
  log(`[${TAG}] ${label} HTTP ${res.status}: ${raw.slice(0, 300)}`);

  let json = {};
  try {
    json = JSON.parse(raw);
  } catch {
    /* non-JSON — already logged */
  }

  return { status: res.status, ok: res.ok, raw, json };
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "vibeflixtv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    taskId,
    emitter,
    log = () => {},
  }) {
    const firstName = generateUsername().slice(0, 12);
    const lastName = firstName;

    // ── Step 1: Solve Cloudflare Turnstile ────────────────────────────────────
    log(`[${TAG}] 🛡️ Requesting Cloudflare Turnstile solution...`);
    const turnstileToken = await awaitCaptcha(
      taskId,
      emitter,
      PAGE_URL,
      TURNSTILE_SITEKEY,
      TAG,
      log,
      "turnstile",
    );

    // ── Step 2: Send verification code to email ───────────────────────────────
    log(`[${TAG}] 📝 Submitting trial request for ${email}...`);

    // _ft must be set at page-load time (anti-spam timing check).
    // We record it before the Turnstile solve so the delta looks realistic.
    const ft = String(Date.now() - Math.floor(Math.random() * 8_000 + 4_000));

    const {
      ok: sendOk,
      status: sendStatus,
      json: sendJson,
      raw: sendRaw,
    } = await vibePost(
      SEND_URL,
      {
        firstName,
        lastName,
        email,
        device: "pc",
        region: "all",
        turnstileToken,
        website: "", // honeypot — must be empty
        _ft: ft,
      },
      log,
      "send-verification",
    );

    // The server returns { status: "success" } on success (not { success: true }).
    if (!sendOk || sendJson?.status !== "success") {
      const reason =
        sendJson?.error ?? sendJson?.message ?? sendRaw.slice(0, 200);
      // 429 = IP-level rate limit (daily cap) — surface a clear message.
      if (sendStatus === 429) {
        throw new Error(`[${TAG}] ${reason}`);
      }
      throw new Error(
        `[${TAG}] Verification request rejected (HTTP ${sendStatus}): ${reason}`,
      );
    }

    log(`[${TAG}] ✅ Verification code sent to ${email}. Polling inbox...`);

    // ── Step 3: Poll inbox for the 6-digit verification code ──────────────────
    // Sender: VibeFlix TV <geoiptv.store@gmail.com>, subject: "Your VibeFlix TV Verification Code"
    const code = await provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: SENDER_VERIFICATION,
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });

    if (!code) {
      throw new Error(
        `[${TAG}] Verification code email did not arrive in time.`,
      );
    }
    log(`[${TAG}] ✅ 🔐 Verification code: ${code}`);

    // ── Step 4: Submit code → create trial account ────────────────────────────
    log(`[${TAG}] 🎁 Creating trial account...`);

    const {
      ok: verifyOk,
      status: verifyStatus,
      json: verifyJson,
      raw: verifyRaw,
    } = await vibePost(
      VERIFY_URL,
      {
        firstName,
        lastName,
        email,
        code,
        device: "pc",
        region: "all",
      },
      log,
      "verify-and-create-trial",
    );

    if (!verifyOk || verifyJson?.status !== "success") {
      throw new Error(
        `[${TAG}] Trial creation failed (HTTP ${verifyStatus}): ` +
          `${verifyJson?.error ?? verifyJson?.message ?? verifyRaw.slice(0, 200)}`,
      );
    }

    // The server may return the username at the top level or nested under data.
    const d = verifyJson?.data ?? verifyJson;
    const usernameFromApi = d?.username ?? d?.user ?? null;

    log(
      `[${TAG}] ✅ 📺 Trial active — username: ${usernameFromApi ?? "(see email"}, M3U: check email`,
    );

    // ── Step 5: Poll inbox for the credentials email ───────────────────────────
    // The API doesn't return the M3U or password — they arrive in a separate email.
    log(`[${TAG}] 📬 Waiting for credentials email...`);
    const credentialsBody = await provider.waitForVerificationCodeEmail(
      credentialStore,
      {
        filterText: SENDER_CREDENTIALS,
        codeRe: CREDENTIALS_RE,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    const playlists = credentialsBody
      ? extractPlaylists(credentialsBody)
      : null;
    const creds = playlists?.tvPlaylist
      ? extractCredsFromM3u(playlists.tvPlaylist)
      : null;

    if (!playlists?.tvPlaylist) {
      log(
        `[${TAG}] ⚠️ Credentials email did not contain an M3U URL — returning partial result.`,
        "warn",
      );
    } else {
      log(`[${TAG}] ✅ M3U extracted: ${playlists.tvPlaylist}`);
    }

    return buildResult({
      username: creds?.user ?? usernameFromApi,
      password: creds?.pass ?? null,
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
