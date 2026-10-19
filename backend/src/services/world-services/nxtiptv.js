/**
 * NxtIPTV — free trial (Cloudflare Turnstile-protected form).
 *
 * Site: https://www.nxtiptv.co/trial/
 *
 * Flow:
 *   1. GET /trial/           → session cookies + _csrf hidden input
 *   2. Prompt user to solve Cloudflare Turnstile → resolve token
 *   3. POST /trial/          → submit _csrf + type + mac + email + cf-turnstile-response
 *   4. Poll inbox            → wait for credentials email, extract M3U links
 */
import { buildResult } from "../../parsing/generators.js";
import {
  createJar,
  get,
  post,
  extractInputValue,
  plainText,
} from "../../http/cookieClient.js";
import { awaitCaptcha } from "../../engine/captcha.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "NxtIPTV";
const BASE_URL = "https://www.nxtiptv.co";
const TRIAL_URL = `${BASE_URL}/trial/`;
// Fallback Turnstile sitekey confirmed from live page data-sitekey attribute.
const SITEKEY = "0x4AAAAAAAiTREDWHkI38_9S";
const TRIAL_HOURS = 24;

// Strings used to identify the credentials email in the inbox.
const FILTER_TEXT = ["nxtiptv", "nxtiptv.co"];

// Browser-like headers to pass server checks.
const BROWSER_HEADERS = {
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Upgrade-Insecure-Requests": "1",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extracts the Cloudflare Turnstile sitekey from the page HTML.
// Looks for data-sitekey="..." on the cf-turnstile widget div.
function extractTurnstileSitekey(html) {
  return (
    html.match(/<[^>]*cf-turnstile[^>]*data-sitekey="([^"]+)"/i)?.[1] ??
    html.match(/data-sitekey="([^"]+)"[^>]*cf-turnstile/i)?.[1] ??
    html.match(/data-sitekey="([^"]+)"/i)?.[1] ??
    null
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "nxtiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "best",
  },

  async execute({
    provider,
    credentialStore,
    email,
    taskId,
    emitter,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();

    // Step 1: Load the trial page — grab the session cookie and hidden _csrf token.
    log(`[${TAG}] 🔐 Loading trial page...`);
    const { text: pageHtml, status: pageStatus } = await get(TRIAL_URL, jar, {
      extraHeaders: BROWSER_HEADERS,
    });

    if (pageStatus >= 400)
      throw new Error(
        `[${TAG}] Failed to load trial page — HTTP ${pageStatus}`,
      );

    // The form uses name="_csrf" (not "_token"), so use extractInputValue.
    const csrf = extractInputValue(pageHtml, "_csrf");
    if (!csrf)
      throw new Error(
        `[${TAG}] Could not extract CSRF token from the trial page.`,
      );

    // Read the real sitekey from the page's cf-turnstile widget; fall back to known value.
    const sitekey = extractTurnstileSitekey(pageHtml) ?? SITEKEY;

    // Step 2: Prompt the user to solve the Cloudflare Turnstile challenge.
    const turnstileToken = await awaitCaptcha(
      taskId,
      emitter,
      TRIAL_URL,
      sitekey,
      TAG,
      log,
      "turnstile",
    );
    log(
      `[${TAG}] ✅ 🤖 Turnstile solved — submitting trial form for ${email}...`,
    );

    // Step 3: POST the trial form.
    const { status, text, finalUrl } = await post(
      TRIAL_URL,
      jar,
      {
        _csrf: csrf,
        type: "app",
        mac: "",
        email: email.trim(),
        "cf-turnstile-response": turnstileToken,
      },
      TRIAL_URL,
      { extraHeaders: BROWSER_HEADERS },
    );

    if (status >= 400) {
      const reason = plainText(text ?? "").slice(0, 120);
      log(`[${TAG}] ❌ HTTP ${status} | ${finalUrl} | ${reason}`, "warn");
      throw new Error(
        `[${TAG}] Trial form rejected — HTTP ${status}: ${reason}`,
      );
    }

    // Step 4: Poll the inbox for the credentials email and extract M3U links.
    log(`[${TAG}] ✅ Trial form accepted. 📬 Waiting for credentials email...`);
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] ⚠️ No M3U links found.`, "warn");
    else
      log(
        `[${TAG}] ✅ TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
