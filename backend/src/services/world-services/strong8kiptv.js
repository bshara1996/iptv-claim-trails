/**
 * Strong8K IPTV — free trial via GET-then-POST form submission.
 * Site: https://strong8kiptv.co/trial
 *
 * Flow:
 *   1. GET /trial → prime session cookies + extract hidden CSRF _token (if present)
 *   2. POST /trial with form fields including _token (if found) → follow redirect → 2xx
 *   3. Poll inbox for credentials email
 *
 * Fix (HTTP 409): the server requires a session established by loading GET /trial
 * first.  It may also require a CSRF _token echoed back from the page HTML.
 * If no _token is found the POST proceeds without it (the site may not use Laravel).
 */
import { buildResult } from "../../parsing/generators.js";
import {
  createJar,
  get,
  post,
  extractCsrfToken,
} from "../../http/cookieClient.js";

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

    // Step 1: GET /trial — prime session cookies and extract CSRF token.
    log(`[${TAG}] Loading trial page to establish session...`);
    const { text: trialPage, status: getStatus } = await get(TRIAL_URL, jar);
    if (getStatus >= 400)
      throw new Error(
        `[${TAG}] Failed to load trial page (HTTP ${getStatus}).`,
      );

    const token = extractCsrfToken(trialPage);
    if (!token) log(`[${TAG}] No CSRF _token found — proceeding without it.`);

    // Step 2: Submit the trial form (form-encoded, not JSON).
    log(`[${TAG}] Submitting free trial request for ${email}...`);
    const postBody = {
      format: "m3u",
      m3u: "m3u",
      mac: "",
      package: "83106", // Arabic Package — 53105
      email: email.trim(),
    };
    if (token) postBody._token = token;

    const { status } = await post(
      TRIAL_URL,
      jar,
      postBody,
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
