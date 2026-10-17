/**
 * Strong8K IPTV — free trial via POST form submission.
 * Site: https://strong8kiptv.co/trial
 *
 * Flow:
 *   POST /trial with form parameters: format, m3u, mac, package, email
 *   → Waits for credentials email
 *
 * Fix: was using simplePost (JSON body) against a form handler that requires
 * application/x-www-form-urlencoded.  Replaced with the cookieClient `post`
 * helper, which sets the correct Content-Type and URL-encodes the body.
 */
import { buildResult } from "../../parsing/generators.js";
import { createJar, post } from "../../http/cookieClient.js";

const TAG = "Strong8K IPTV";
const TRIAL_URL = "https://strong8kiptv.co/trial";
const TRIAL_HOURS = 24;
const FILTER_TEXT = ["strong8k", "strong8kiptv.co"];

export default {
  meta: {
    id: "strong8kiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "other",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();

    // Submit the trial form (form-encoded, not JSON)
    log(`[${TAG}] Submitting free trial request for ${email}...`);
    const { status } = await post(
      TRIAL_URL,
      jar,
      {
        format: "m3u",
        m3u: "m3u",
        mac: "",
        package: "83106", // Arabic Package — 53105
        email: email.trim(),
      },
      TRIAL_URL, // referer
    );

    if (status >= 400)
      throw new Error(`[${TAG}] Trial request rejected (HTTP ${status}).`);

    log(`[${TAG}] Trial request submitted. Waiting for credentials email...`);

    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] No M3U links found in credentials email.`, "warn");
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
