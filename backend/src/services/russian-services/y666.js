/**
 * Y666 (my.y666.tv) — free IPTV trial via email-verified registration.
 *
 * Flow:
 *   1. POST /api/auth/register  → submit username + email + password
 *   2. Poll inbox               → wait for verification email link
 *   3. GET  /api/email/verify   → confirm email via token from the link
 *   4. Build M3U playlist URLs from username + password
 *
 * Retries with a fresh email when the address is already registered (userExists).
 */
import {
  buildResult,
  generatePassword,
  generateUsername,
} from "../../parsing/generators.js";
import { DEFAULT_UA } from "../../http/cookieClient.js";
import { retryWithFreshEmail } from "../../email/base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://my.y666.tv";
const API_BASE = `${BASE_URL}/api`;
const TAG = "Y666";
const FILTER_TEXT = ["Y6TV ", "noreply@y6tv.tv"];
const PLAYLIST_BASE = "http://pl.y6tv.me";
const TRIAL_DAYS = 3;
const TRIAL_HOURS = TRIAL_DAYS * 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// JSON fetch helper — throws with the server's error field on non-2xx.
async function apiFetch(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "User-Agent": DEFAULT_UA,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error ?? data?.message ?? `HTTP ${response.status}`;
    throw new Error(`[${TAG}] ${message}`);
  }

  return data;
}

// Step 1: Submit registration — throws "userExists" if the email is taken.
async function register(email, username, password) {
  await apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password, language: "en" },
  });
}

// Steps 2-3: Poll inbox for the verification link, then confirm the email.
async function verifyEmail(provider, store, seenIds, log) {
  log(`[${TAG}] 📩 Polling inbox for verification link...`);
  const link = await provider.waitForEmailAndExtractLink(store, {
    filterText: FILTER_TEXT,
    pattern: /my\.y666\.tv\/verify-email\?token=/i,
    seenIds: new Set(seenIds),
    timeout: 120_000,
  });

  if (!link) throw new Error(`[${TAG}] Verification email not received.`);

  let token;
  try {
    token = new URL(link).searchParams.get("token");
  } catch {
    throw new Error(`[${TAG}] Invalid verification link received.`);
  }
  if (!token)
    throw new Error(`[${TAG}] Could not extract token from verification link.`);

  log(`[${TAG}] 🔗 Verification link received.`);
  log(`[${TAG}] 🔐 Verifying email...`);
  const result = await apiFetch(
    `/email/verify?token=${encodeURIComponent(token)}`,
  );
  if (result?.success === false)
    throw new Error(`[${TAG}] Email verification was rejected.`);
  log(`[${TAG}] ✅ Email verified.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "y666",
    name: "Y666",
    description: `${TRIAL_DAYS} Days`,
    group: "russian",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    return retryWithFreshEmail(
      async (email) => {
        const username = generateUsername();
        const password = generatePassword();

        log(`[${TAG}] 📝 Registering account for ${email}...`);
        await register(email, username, password);
        log(
          `[${TAG}] ✅ Registration submitted — check inbox for verification email.`,
        );

        await verifyEmail(provider, credentialStore, inboxSeenIds, log);

        const playlistPath = `${PLAYLIST_BASE}/${username}/${password}`;
        const tvPlaylist = `${playlistPath}/tv.m3u`;
        const vodPlaylist = `${playlistPath}/vod.m3u`;
        const seriesPlaylist = `${playlistPath}/series.m3u`;
        log(`[${TAG}] 📺 M3U: ${tvPlaylist}`);
        log(`[${TAG}] 🍿 VOD M3U: ${vodPlaylist}`);
        log(`[${TAG}] 🎬 Series M3U: ${seriesPlaylist}`);

        return buildResult({
          username,
          password,
          tvPlaylist,
          vodPlaylist: `${vodPlaylist}\n${seriesPlaylist}`,
          trialHours: TRIAL_HOURS,
          serviceName: TAG,
        });
      },
      {
        provider,
        credentialStore,
        email,
        inboxSeenIds,
        log,
        tag: TAG,
        shouldRetry: (err) => err.message.includes("userExists"),
      },
    );
  },
};
