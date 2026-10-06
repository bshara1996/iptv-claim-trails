/**
 * 4K Best IPTV — free trial via checkout API.
 *
 * Site: https://www.4kbestiptv.com
 *
 * Flow:
 *   1. POST /api/checkout with the trial payload.
 *      → Server registers the request and sends credentials to the email.
 *   2. Poll inbox for the confirmation/credentials email containing M3U links.
 *
 * Trial duration: 24 hours (free trial plan).
 */
import { buildResult } from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const PAGE_URL = "https://www.4kbestiptv.com";
const API_URL = "https://www.4kbestiptv.com/api/checkout";
const TAG = "4K Best IPTV";
const TRIAL_HOURS = 24;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "4kbestiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit the trial checkout request.
    log(`[${TAG}] Submitting free trial request for ${email}...`);

    await jsonPost(
      API_URL,
      null,
      {
        method: "trial",
        name: "",
        email: email.trim(),
        whatsapp: "",
        note: "",
        planName: "Free Trial",
        price: "$0.00",
      },
      { referer: PAGE_URL },
    );

    log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);

    // Step 2: Poll inbox for the credentials/confirmation email with M3U links.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!playlists.allM3uLinks.length) {
      log(`[${TAG}] No M3U links found in credentials email.`, "warn");
    } else {
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );
    }

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
