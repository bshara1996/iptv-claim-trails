/**
 * TvOnNet — API-based 12-hour free trial.
 *
 * Site: https://www.tvonnet.live
 *
 * Flow:
 *   POST /api/iptv/provision → response contains M3U links + magicLink directly.
 *
 * Trial duration: 12 hours.
 */
import { buildResult } from "../../../parsing/generators.js";
import { jsonPost } from "../../../http/cookieClient.js";
import { extractM3uLinks } from "../../../parsing/extractors.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.tvonnet.live";
const TAG = "TvOnNet";
const TRIAL_HOURS = 12;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvonnet",
    name: TAG,
    description: `${TRIAL_HOURS} Hours [Limited]`,
    group: "trex",
  },

  async execute({ email, log = () => {} }) {
    // Step 1: POST trial request — response delivers M3U links directly
    log(`[${TAG}] 📝 Submitting trial request...`);
    const data = await jsonPost(
      `${BASE_URL}/api/iptv/provision`,
      null,
      {
        panel: "both", // Server 1 OR Server 2
        duration: "12h",
        connections: 1,
        fullName: "VIP Guest",
        email: email.trim(),
        device: "Windows PC / Mac",
        paymentMethod: "Email Only Pass Delivery",
        includeAdult: false,
      },
      { referer: BASE_URL, origin: BASE_URL, throwOnError: true },
    );

    log(`[${TAG}] 📦 Raw response: ${JSON.stringify(data, null, 2)}`);

    // Step 2: Extract M3U links + magicLink from the response
    const allM3uLinks = extractM3uLinks(data);
    const magicLink = data?.magicLink ?? null;

    if (!allM3uLinks.length)
      log(`[${TAG}] ⚠️ No M3U links found in response.`, "warn");
    else
      log(
        `[${TAG}] ✅ ${allM3uLinks.length} M3U link(s) received:\n${[...allM3uLinks].reverse().join("\n")}`,
      );

    if (magicLink) log(`[${TAG}] 🔗 Magic Link: ${magicLink}`);

    // Step 3: Build TV playlist — server2 first, primary second, magicLink last
    const orderedLinks = [...allM3uLinks].reverse();
    if (magicLink) orderedLinks.push(magicLink);
    const tvPlaylist = orderedLinks.length ? orderedLinks.join("\n") : null;

    return buildResult({
      allM3uLinks,
      tvPlaylist,
      vodPlaylist: null,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
