/**
 * Watch5 TV — Supabase-based free trial.
 *
 * Site: https://watch5tv.com
 *
 * Flow:
 *   1. POST /auth/v1/signup        → sends verification email.
 *   2. Poll inbox → click verify link → confirm account.
 *   3. POST /auth/v1/token         → sign in, get access token.
 *   4. POST w5-provision-trial     → provision the trial.
 *   5. GET  /rest/v1/subscriptions → build M3U from Xtream credentials.
 *
 * Trial duration: 24 hours.
 */

import { buildResult, buildM3u } from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "Watch5 TV";
const TRIAL_HOURS = 24;

const SUPABASE = "https://rrhjvsmabnjvdymvgved.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyaGp2c21hYm5qdmR5bXZndmVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzOTUxODAsImV4cCI6MjA5NDk3MTE4MH0.zuTpCP09sgAFX4nxfL68kPe-WWlijPseRwsmp1ZkBPo";
const PROVISION_URL =
  "https://watch5tv.com/.netlify/functions/w5-provision-trial";
const FILTER_TEXT = ["WATCH5TV", "info@watch5tv.com"];
const SIGNUP_REDIRECT =
  "https%3A%2F%2Fwatch5tv.com%2Fwatch5%2Fauth%2Fcallback%3Fnext%3D%252Fwatch5%252Fdashboard";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Posts to a Supabase auth/REST endpoint; injects apikey + optional Bearer token.
const sbPost = (path, body, token) =>
  jsonPost(`${SUPABASE}${path}`, null, body, {
    extraHeaders: {
      apikey: ANON_KEY,
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

// Gets a Supabase REST endpoint; injects apikey + Bearer token, returns parsed JSON.
async function sbGet(path, token) {
  const res = await fetch(`${SUPABASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(
      `[${TAG}] ${path} (${res.status}): ${json.message ?? JSON.stringify(json)}`,
    );
  return json;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "watch5tv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours [Limited]`,
    group: "best",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const password = `W5_${username.slice(0, 8)}!2025`;

    // Step 1: Create account — server sends a verification email.
    log(`[${TAG}] 📝 Registering account...`);
    const signup = await sbPost(
      `/auth/v1/signup?redirect_to=${SIGNUP_REDIRECT}`,
      {
        email,
        password,
        data: { full_name: username },
        gotrue_meta_security: {},
        code_challenge: null,
        code_challenge_method: null,
      },
    );

    // Step 2: Poll inbox for the confirmation email, then click the verify link.
    log(`[${TAG}] 📬 Waiting for verification email...`);
    const verifyLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        pattern: /supabase\.co\/auth\/v1\/verify/i,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );
    if (!verifyLink)
      throw new Error(`[${TAG}] Verification email did not arrive in time.`);

    log(`[${TAG}] 🔗 Clicking verification link...`);
    await fetch(verifyLink, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    // Step 3: Sign in with password to get the access token from JSON.
    log(`[${TAG}] 🔑 Signing in...`);
    const signin = await sbPost("/auth/v1/token?grant_type=password", {
      email,
      password,
    });
    const token = signin.access_token;
    const userId = signin.user?.id ?? signup.user?.id;

    // Step 4: Provision the 24-hour trial via the Netlify function.
    log(`[${TAG}] 🎁 Provisioning trial...`);
    await jsonPost(
      PROVISION_URL,
      null,
      { template_id: null, is_adult: false, domain_id: null },
      {
        extraHeaders: { Authorization: `Bearer ${token}` },
      },
    );

    // Step 5: Fetch the subscription row; build an Xtream Codes M3U URL.
    log(`[${TAG}] 📡 Fetching subscription...`);
    const query = userId
      ? `/rest/v1/subscriptions?select=*&user_id=eq.${userId}&order=created_at.desc&limit=10`
      : `/rest/v1/subscriptions?select=*&order=created_at.desc&limit=1`;
    const subs = await sbGet(query, token);
    const sub = Array.isArray(subs) ? subs[0] : subs;
    const m3uUrl = buildM3u(
      sub?.iptv_server,
      sub?.iptv_username,
      sub?.iptv_password,
    );

    if (m3uUrl) log(`[${TAG}] ✅ 🎁 Trial activated. 📺 M3U: ${m3uUrl}`);
    else
      log(
        `[${TAG}] ⚠️ Trial provisioned but no M3U found in subscription.`,
        "warn",
      );

    return buildResult({
      username: sub?.iptv_username ?? null,
      password: sub?.iptv_password ?? null,
      tvPlaylist: m3uUrl,
      allM3uLinks: m3uUrl ? [m3uUrl] : [],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
