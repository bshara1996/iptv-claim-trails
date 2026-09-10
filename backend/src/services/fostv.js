/**
 * Fos TV (fostv.io) — free 24-hour trial via a single REST endpoint.
 *
 * Flow:
 *   1. POST /api/submit-trial — no captcha, no OTP required.
 *   2. Poll inbox for the welcome email containing M3U credentials.
 *
 * Notes:
 *   - website_id is a static value from <meta name="website-id"> on the page.
 *   - customer_phone is used only for WhatsApp outreach; not validated server-side.
 *   - Credentials are delivered exclusively by email — nothing in the API response.
 *   - Timeout is 5 min; site states delivery can take up to 30 min overnight.
 */
import {
  generateUsername,
  generatePhone,
  buildResult,
} from "../parsing/generators.js";
import { jsonPost } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://fostv.io/free-trial";
const API_URL = "https://fostv.io/api/submit-trial";
const WEBSITE_ID = "d9ea854b-d576-41b4-9ea5-e3be27af5b41";
const TAG = "Fos TV";
const TRIAL_HOURS = 24;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: { id: "fostv", name: "Fos TV", description: `${TRIAL_HOURS} Hours` },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit the trial request — server queues the credential email.
    await jsonPost(
      API_URL,
      null,
      {
        website_id: WEBSITE_ID,
        website_url: "fostv.io",
        customer_name: generateUsername(),
        customer_email: email.trim(),
        customer_phone: generatePhone(),
      },
      { referer: TRIAL_URL },
    );
    log(`[${TAG}] Trial request submitted.`);

    // Step 2: Poll inbox for the welcome email containing M3U/Xtream credentials.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      { filterText: "fostv", seenIds: new Set(inboxSeenIds), timeout: 300_000 },
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
      serviceName: TAG,
    });
  },
};
