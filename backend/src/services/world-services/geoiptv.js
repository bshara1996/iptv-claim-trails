/**
 * Geo IPTV — free 24-hour trial via the site's generate endpoint.
 *
 * Flow:
 *   1. POST the trial form with the selected temporary email address.
 *   2. Poll the inbox for host, username, and password.
 *   3. Build the M3U URL from the email credentials.
 */
import { buildM3u, buildResult } from "../../parsing/generators.js";
import { createJar, post, errSnippet } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://trial.geoiptv.com.pk/generate.php";
const PAGE_ORIGIN = "https://geoiptv.com.pk";
const TAG = "Geo IPTV";
const TRIAL_HOURS = 24;
const CREDENTIALS_RE =
  /((?:Host|🌐)[\s\S]{0,400}?(?:Username|👤)[\s\S]{0,150}?(?:Password|🔑)[^\r\n]*)/i;

// Parses the Markdown-formatted host and credentials from the trial email.
function extractTrialCredentials(content) {
  const plain = content.replace(/\*{1,2}/g, "");
  const host = /https?:\/\/[^\s)\]]+/i.exec(plain)?.[0];
  const username = /Username\s*:\s*([^\s]+)/i.exec(plain)?.[1];
  const password = /Password\s*:\s*([^\s]+)/i.exec(plain)?.[1];

  if (!host || !username || !password) return null;

  try {
    return { serverUrl: new URL(host).origin, username, password };
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "geoiptv",
    name: "Geo IPTV",
    description: "Email delivery",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit the trial form.
    log(`[${TAG}] Submitting trial request for ${email}...`);
    const { text, status } = await post(
      TRIAL_URL,
      createJar(),
      {
        action: "submit_trial",
        email,
        page_origin: PAGE_ORIGIN,
      },
      PAGE_ORIGIN,
      { origin: PAGE_ORIGIN },
    );

    let responseData;
    try {
      responseData = JSON.parse(text);
    } catch {
      responseData = null;
    }

    if (status >= 400 || responseData?.success === false) {
      const message =
        responseData?.error ??
        responseData?.message ??
        (text ? errSnippet(text) : `HTTP ${status}`);
      throw new Error(`[${TAG}] Trial request failed: ${message}`);
    }

    // Step 2: Poll the inbox for the credentials email.
    log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);
    const credentialBlock = await provider.waitForVerificationCodeEmail(
      credentialStore,
      {
        codeRe: CREDENTIALS_RE,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );
    const credentials = credentialBlock
      ? extractTrialCredentials(credentialBlock)
      : null;

    if (!credentials) {
      throw new Error(
        `[${TAG}] Trial email did not contain a valid host, username, and password.`,
      );
    }

    // Step 3: Build the playlist URL from the emailed credentials.
    const m3u = buildM3u(
      credentials.serverUrl,
      credentials.username,
      credentials.password,
    );
    if (!m3u) throw new Error(`[${TAG}] Could not build the M3U link.`);

    log(`[${TAG}] M3U extracted: ${m3u}`);
    return buildResult({
      username: credentials.username,
      password: credentials.password,
      tvPlaylist: m3u,
      allM3uLinks: [m3u],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
