/**
 * BitTV — API-based 24-hour trial registration.
 *
 * Flow:
 *   1. Register an account with a CSRF-protected API request.
 *   2. Confirm the account through the email link.
 *   3. Log in and return the issued M3U playlist.
 */
import {
  generatePassword,
  generateUsername,
  buildResult,
} from "../../parsing/generators.js";
import { createJar, get, jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://bittv.ltd";
const TAG = "BitTV";
const TRIAL_HOURS = 24;
const HOME = `${BASE_URL}/`;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sends API requests and normalizes BitTV's response envelope.
async function api(path, jar, { body, csrf, referer = HOME } = {}) {
  let data;
  if (body) {
    data = await jsonPost(`${BASE_URL}/api/${path}`, jar, body, {
      referer,
      extraHeaders: { "X-CSRF-Token": csrf },
      throwOnError: false,
    });
  } else {
    const response = await get(`${BASE_URL}/api/${path}`, jar, { referer });
    if (response.status >= 400)
      throw new Error(`[${TAG}] ${path} failed (HTTP ${response.status}).`);
    try {
      data = JSON.parse(response.text);
    } catch {
      throw new Error(`[${TAG}] ${path} returned non-JSON content.`);
    }
  }
  if (!data?.ok)
    throw new Error(`[${TAG}] ${data?.error ?? "API request failed."}`);
  return data.data ?? {};
}

// Fetches a short-lived CSRF token for the next API request.
async function csrf(jar, referer, label) {
  const token = (await api("csrf", jar, { referer })).token;
  if (!token) throw new Error(`[${TAG}] ${label} CSRF token was not returned.`);
  return token;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "bittv",
    name: TAG,
    url: BASE_URL,
    description: `${TRIAL_HOURS} Hours`,
    apiOnly: true,
  },

  // Runs registration, email confirmation, authentication, and playlist retrieval.
  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();

    // Register the account and wait for its confirmation email.
    log(`[${TAG}] 🔐 Requesting CSRF token...`);
    const registrationCsrf = await csrf(jar, HOME, "Registration");

    log(`[${TAG}] 📝 Registering ${username} for ${email}...`);
    const { message: registrationMessage } = await api("auth/register", jar, {
      csrf: registrationCsrf,
      body: {
        login: username,
        email: email.trim(),
        password,
        password_confirm: password,
        agree: true,
        captcha: "",
      },
    });
    log(
      `[${TAG}] ✅ Registration accepted. 📩 Waiting for email confirmation...`,
    );

    const confirmationLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: "bittv",
        // Accept only BitTV confirmation URLs with an alphanumeric token.
        pattern:
          /https?:\/\/(?:www\.)?bittv\.ltd\/confirm\.html\?token=[A-Za-z0-9]+/i,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );
    if (!confirmationLink)
      throw new Error(`[${TAG}] Confirmation link not received.`);

    // Open the link to establish the confirmation session before submitting its token.
    const confirmationPage = await get(confirmationLink, jar, {
      referer: HOME,
    });
    if (confirmationPage.status >= 400)
      throw new Error(`[${TAG}] Failed to open confirmation page.`);

    const token = new URL(confirmationLink).searchParams.get("token");
    if (!token)
      throw new Error(`[${TAG}] Confirmation link did not contain a token.`);

    log(`[${TAG}] 🔗 Submitting email confirmation token...`);
    const confirmationCsrf = await csrf(jar, confirmationLink, "Confirmation");
    const { message: confirmationMessage } = await api("auth/confirm", jar, {
      csrf: confirmationCsrf,
      body: { token },
      referer: confirmationLink,
    });
    log(
      `[${TAG}] ✅ Email confirmed: ${confirmationMessage ?? "verification accepted"}.`,
    );

    // Log in again after confirmation, then retrieve the subscription playlist.
    const loginReferer = `${BASE_URL}/?login=1`;
    log(`[${TAG}] 🔐 Refreshing session token after confirmation...`);
    const loginCsrf = await csrf(jar, loginReferer, "Login");

    log(`[${TAG}] 🔑 Signing in as ${username}...`);
    await api("auth/login", jar, {
      csrf: loginCsrf,
      body: { login: username, password },
      referer: loginReferer,
    });

    const subscription = await api("subscription", jar, {
      referer: loginReferer,
    });
    // Keep both playlist variants while exposing the first one as the TV playlist.
    const allM3uLinks = [
      subscription.playlist_m3u,
      subscription.playlist_ott,
    ].filter(Boolean);
    const tvPlaylist = allM3uLinks[0] || null;

    if (tvPlaylist) log(`[${TAG}] ✅ 📺 M3U: ${tvPlaylist}`);
    else log(`[${TAG}] ⚠️ No M3U playlist returned by the cabinet.`, "warn");

    return buildResult({
      username,
      password,
      tvPlaylist,
      allM3uLinks,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
      note: `${registrationMessage ?? `${TAG} account registered`} and authenticated. ` +
        `(${TRIAL_HOURS} Hours)`,
    });
  },
};
