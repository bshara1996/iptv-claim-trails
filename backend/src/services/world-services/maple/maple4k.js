/**
 * Maple 4K IPTV — free trial via a single POST request.
 *
 * Site: https://iptv-trial-maple4k.medmaar.workers.dev/
 *
 * Flow:
 *   1. POST / with the trial payload (name, email, country, device, whatsapp, notes).
 *      → Server registers the trial and sends credentials to the email.
 *   2. Poll inbox for the confirmation/credentials email containing M3U links.
 *
 * Trial duration: 24 hours.
 */
import { buildResult } from "../../../parsing/generators.js";
import { jsonPost } from "../../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL = "https://iptv-trial-maple4k.medmaar.workers.dev/";
const TAG = "Maple 4K IPTV";
const SENDER = "help@maple4k.ca";
const TRIAL_HOURS = 24;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "maple4k",
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
    // Step 1: Submit the trial request.
    log(`[${TAG}] Submitting free trial request for ${email}...`);

    await jsonPost(
      API_URL,
      null,
      {
        name: email.split("@")[0],
        email: email.trim(),
        country: "United Arab Emirates",
        device: "PC Windows / Mac",
        whatsapp: "",
        notes: "",
      },
      { referer: API_URL },
    );

    log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);

    // Step 2: Poll inbox for the credentials/confirmation email with M3U links.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: SENDER,
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
