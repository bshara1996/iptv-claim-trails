/**
 * VocoIPTV — free 24-hour trial claim via direct API.
 *
 * 1. POST the trial registration payload to the submit-trial API.
 * 2. Poll the inbox for the confirmation email containing M3U playlist links.
 * Trial duration: 24 hours.
 */
import { generateUsername, buildResult } from "../parsing/generators.js";
import { jsonPost } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://vocoiptv.tv/free-trial";
const API_URL = "https://vocoiptv.tv/api/submit-trial";
const WEBSITE_ID = "2db060a8-a719-4fd8-abeb-eb5250c86c9b";
const TAG = "VocoIPTV";
const TRIAL_HOURS = 24;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "vocoiptv",
    name: "VocoIPTV",
    description: "24 Hours",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit the trial request to the API.
    await jsonPost(
      API_URL,
      null,
      {
        website_id: WEBSITE_ID,
        customer_name: generateUsername(),
        customer_email: email.trim(),
        customer_phone: "",
        website_url: "vocoiptv.tv",
        source_site: "vocoiptv.tv",
        company_name: "", // honeypot — must stay empty
        turnstile_token: "",
      },
      { referer: TRIAL_URL },
    );
    log(`[${TAG}] Trial request submitted via API.`);

    // Step 2: Poll inbox for confirmation email with M3U links.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: "voco",
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
    else
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: "VocoIPTV",
    });
  },
};
