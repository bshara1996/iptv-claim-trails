/**
 * GreatestIPTV — free trial claim via direct API.
 *
 * 1. POST the trial registration payload to the orders API.
 * 2. Poll the inbox for the confirmation email containing M3U playlist links.
 * Trial duration: 36 hours.
 */
import { computeExpiresAt } from "../parsing/generators.js";
import { buildResult } from "../parsing/result.js";
import { jsonPost } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://www.greatestiptv.com/free-trial/?trial=true";
const API_URL = "https://www.greatestiptv.com/api/orders";
const TAG = "GreatestIPTV";
const TRIAL_HOURS = 36;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "greatestiptv",
    name: "GreatestIPTV",
    description: "36 Hours",
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
        planId: "trial",
        email: email.trim(),
        planType: "standard",
        hasAdultContent: false,
      },
      { referer: TRIAL_URL },
    );
    log(`[${TAG}] Trial request submitted via API.`);

    // Step 2: Poll inbox for confirmation email with M3U links.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: "greatest",
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
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks,
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt:
        playlists.expiresAt ??
        computeExpiresAt(TRIAL_HOURS * 3_600_000, {
          timeZone: "Asia/Jerusalem",
        }),
      note: playlists.tvPlaylist
        ? "36-hour GreatestIPTV trial activated successfully."
        : "Trial activated — M3U link not found in confirmation email.",
    });
  },
};
