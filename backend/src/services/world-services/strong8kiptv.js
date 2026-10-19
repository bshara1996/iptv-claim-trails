/**
 * Strong8K IPTV — free 24-hour trial.
 *
 * Site: https://strong8kiptv.co
 *
 * Flow:
 *   1. POST /trial  → submit email + package (Sec-Fetch-* headers required,
 *                     server rejects non-browser submits with HTTP 409)
 *   2. Poll inbox   → wait for credentials email with M3U links
 */
import { buildResult } from "../../parsing/generators.js";
import { createJar, post } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "Strong8K IPTV";
const TRIAL_URL = "https://strong8kiptv.co/trial";
const TRIAL_HOURS = 24;

// Strings used to identify the credentials email in the inbox.
const FILTER_TEXT = ["Strong IPTV 8K", "emily@strong8kiptv.co"];

// Required to pass the server's browser-only check.
const BROWSER_HEADERS = {
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-User": "?1",
  "Sec-Fetch-Dest": "document",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "strong8kiptv",
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
    // Step 1: Submit the trial request form.
    log(`[${TAG}] 📝 Submitting free trial for ${email}...`);

    const { status, text, finalUrl } = await post(
      TRIAL_URL,
      createJar(),
      { format: "m3u", mac: "", package: "83106", email: email.trim() },
      TRIAL_URL,
      { extraHeaders: BROWSER_HEADERS },
    );

    // Extract the human-readable error from the page's notice paragraph when available.
    if (status >= 400) {
      const reason =
        text
          ?.match(/<p[^>]*notice-error[^>]*>([\s\S]*?)<\/p>/i)?.[1]
          .replace(/<[^>]+>/g, "")
          .trim() ?? `HTTP ${status}`;
      log(`[${TAG}] ❌ ${status} | ${finalUrl} | ${reason}`, "warn");
      throw new Error(`[${TAG}] Trial request rejected — ${reason}`);
    }

    // Step 2: Poll inbox for the credentials email and extract M3U links.
    log(`[${TAG}] 📬 Waiting for credentials email...`);
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
