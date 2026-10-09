/**
 * TvOnNet — API-based 12-hour free trial.
 *
 * Site: https://www.tvonnet.live
 *
 * Flow:
 *   POST /api/iptv/provision with trial details.
 *   Response contains one or more M3U links directly.
 *
 * Trial duration: 12 hours.
 */
import { buildResult } from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.tvonnet.live";
const TAG = "TvOnNet";
const TRIAL_HOURS = 12;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvonnet",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "other",
  },

  async execute({ email, log = () => {} }) {
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

    // Extract all M3U links from the response (may be nested anywhere)
    const allM3uLinks = extractM3uLinks(data);

    if (!allM3uLinks.length)
      log(`[${TAG}] ⚠️ No M3U links found in response.`, "warn");
    else log(`[${TAG}] ✅ ${allM3uLinks.length} M3U link(s) received.`);

    return buildResult({
      allM3uLinks,
      tvPlaylist: allM3uLinks[0] ?? null,
      vodPlaylist: allM3uLinks[1] ?? null,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Recursively collect every string that looks like an M3U URL from any response shape.
function extractM3uLinks(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.values(obj).flatMap((v) => {
    if (typeof v === "string" && /\.m3u|get\.php|type=m3u/i.test(v)) return [v];
    if (typeof v === "object") return extractM3uLinks(v);
    return [];
  });
}
