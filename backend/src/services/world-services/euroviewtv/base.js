/**
 * EuroView TV — shared base for all server variants.
 *
 * Site: https://euroview-tv.com
 *
 * Flow (first variant):
 *   1. POST /auth/v1/signup          → create account, triggers verification email.
 *   2. Poll inbox                    → extract confirmation link from the email button.
 *   3. GET  verify link              → activate the account.
 *   4. POST /auth/v1/token           → exchange credentials for an access token.
 *   5. POST /functions/v1/request-trial → returns the M3U playlist URL.
 *
 * Flow (subsequent variant, same task — account already exists):
 *   Steps 1–3 are skipped. Goes straight to login (step 4) then trial (step 5).
 */

import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../../../parsing/generators.js";
import { DEFAULT_UA, jsonPost, get } from "../../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE = "https://hjureeafadtdxdahdluw.supabase.co";
const ANON_KEY = "sb_publishable_Ow785TpwAbg7FHm2ZVAAIQ_nnAhmMnV";
const SIGNUP_URL = `${SUPABASE}/auth/v1/signup?redirect_to=https%3A%2F%2Feuroview-tv.com%2Fauth%2Fcallback`;
const LOGIN_URL = `${SUPABASE}/auth/v1/token?grant_type=password`;
const TRIAL_URL = `${SUPABASE}/functions/v1/request-trial`;

// Key used to persist the password across variants within the same task.
const STORE_KEY = "euroviewtv_password";

export const DEVICE_TYPE = "m3u";

// Supabase verify URL embedded as a button href in the confirmation email.
const VERIFY_LINK_RE =
  /https:\/\/hjureeafadtdxdahdluw\.supabase\.co\/auth\/v1\/verify\?[^"'\s<>]+/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns Supabase API headers; swaps in the user token when provided.
const apiHeaders = (token = null) => ({
  apikey: ANON_KEY,
  Authorization: `Bearer ${token ?? ANON_KEY}`,
  "User-Agent": DEFAULT_UA,
});

// ── Base execute ──────────────────────────────────────────────────────────────

export async function executeEuroView(
  ctx,
  { serverId, tag, getExpiry = null, trialHours = 24 },
) {
  const {
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  } = ctx;
  const opts = { extraHeaders: apiHeaders() };

  // Re-use the password from a previous variant in this task, or generate a new one.
  const alreadyRegistered = !!credentialStore[STORE_KEY];
  const password = alreadyRegistered
    ? credentialStore[STORE_KEY]
    : (credentialStore[STORE_KEY] = generatePassword());

  if (alreadyRegistered) {
    // Account already created by a previous variant — skip signup and verification.
    log(
      `[${tag}] ♻️ Account already registered for this task. Skipping to login...`,
    );
  } else {
    // Step 1: Create account — Supabase sends a verification email.
    log(`[${tag}] 📝 Registering account for ${email}...`);
    log(`[${tag}] 🔐 Generated password: ${password}`);
    await jsonPost(
      SIGNUP_URL,
      null,
      {
        email,
        password,
        data: { full_name: generateUsername().slice(0, 12) },
        gotrue_meta_security: {},
        code_challenge: null,
        code_challenge_method: null,
      },
      opts,
    );

    // Step 2: Poll inbox for the verification email and extract the link.
    log(`[${tag}] ✅ Account created. Waiting for verification email...`);
    const rawLink = await provider.waitForEmailAndExtractLink(credentialStore, {
      filterText: "EuroView",
      pattern: VERIFY_LINK_RE,
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });
    if (!rawLink)
      throw new Error(`[${tag}] Verification email did not arrive in time.`);

    // Step 3: Follow the verify link to activate the account.
    log(`[${tag}] 🔗 Verification link received. Confirming account...`);
    await get(rawLink.replace(/&amp;/g, "&"), null, { ua: DEFAULT_UA });
    log(`[${tag}] ✅ Account verified. Logging in...`);
  }

  // Step 4: Sign in to get an access token.
  const { access_token } = await jsonPost(
    LOGIN_URL,
    null,
    { email, password },
    opts,
  );
  if (!access_token)
    throw new Error(`[${tag}] No access token returned after login.`);

  // Step 5: Claim the trial — response contains M3U URL and credentials.
  log(`[${tag}] 🔑 Authenticated. Claiming trial...`);
  const trialBody = await jsonPost(
    TRIAL_URL,
    null,
    { device_type: DEVICE_TYPE, server_id: serverId },
    { extraHeaders: apiHeaders(access_token) },
  );

  const sub = trialBody?.subscription ?? trialBody;
  const m3uLink =
    sub?.m3u_url ?? sub?.m3u ?? sub?.playlist_url ?? sub?.url ?? null;
  const expiryDate = getExpiry
    ? getExpiry()
    : sub?.expires_at
      ? new Date(sub.expires_at)
      : null;

  if (!m3uLink)
    log(
      `[${tag}] ⚠️ No M3U found. Raw: ${JSON.stringify(trialBody).slice(0, 300)}`,
      "warn",
    );
  else {
    log(`[${tag}] ✅ M3U extracted: ${m3uLink}`);
    log(`[${tag}] 📋 Trial response: ${JSON.stringify(trialBody, null, 2)}`);
  }

  return buildResult({
    username: sub?.username ?? null,
    password: sub?.password ?? null,
    tvPlaylist: m3uLink,
    allM3uLinks: m3uLink ? [m3uLink] : [],
    expiryDate,
    trialHours,
    serviceName: tag,
  });
}
