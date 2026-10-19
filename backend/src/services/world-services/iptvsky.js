/**
 * IPTVSky — free 24-hour trial via the site's nonce-protected AJAX endpoint.
 *
 * Site: https://iptvsky.ca
 *
 * Flow:
 *   1. GET /wp-json/iptvsky-trial/v1/nonce → session cookie + nonce
 *   2. POST /wp-admin/admin-ajax.php → Xtream credentials and playlist link
 *
 * Trial duration: 24 hours.
 */
import {
  generatePhone,
  generateUsername,
  buildM3u,
  buildResult,
} from "../../parsing/generators.js";
import { createJar, get, post } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://iptvsky.ca";
const TRIAL_PAGE = `${BASE_URL}/trial/`;
const NONCE_URL = `${BASE_URL}/wp-json/iptvsky-trial/v1/nonce`;
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const TAG = "IPTVSky";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parses JSON text or throws a labelled [TAG] error with a snippet on failure.
const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`[${TAG}] Unexpected ${label}: ${text.slice(0, 80)}`);
  }
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "iptvsky",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "best",
  },

  async execute({ email, log = () => {} }) {
    // Anti-bot protection requires the hc_js_gate session cookie.
    const jar = createJar();
    jar.hc_js_gate = "1";

    // Step 1: fetch the nonce — binds the form submission to the session.
    log(`[${TAG}] 🔐 Requesting trial nonce...`);
    const { text: nonceText, status: nonceStatus } = await get(NONCE_URL, jar, {
      referer: TRIAL_PAGE,
    });
    if (nonceStatus >= 400)
      throw new Error(`[${TAG}] Failed to request nonce.`);

    const nonce = parseJson(nonceText, "nonce response").nonce;
    if (!nonce) throw new Error(`[${TAG}] Trial nonce was not returned.`);

    // Step 2: submit the trial form — credentials are returned directly.
    log(`[${TAG}] 📝 Submitting trial claim for ${email}...`);
    const { text, status } = await post(
      AJAX_URL,
      jar,
      {
        action: "iptvsky_create_trial",
        trial_name: generateUsername(),
        trial_whatsapp: generatePhone(),
        trial_email: email,
        trial_device: "other",
        trial_template: "100003981663766",
        iptvsky_nonce: nonce,
      },
      TRIAL_PAGE,
    );

    const data = parseJson(text, "response");
    if (status >= 400 || !data.success)
      throw new Error(
        `[${TAG}] ${data.data?.message ?? "Trial request rejected."}`,
      );

    const { username, password, host, m3u_link: playlist } = data.data ?? {};
    if (!username || !password || !host)
      throw new Error(`[${TAG}] Trial response missing credentials.`);

    const m3u = playlist ?? buildM3u(host, username, password);
    log(`[${TAG}] ✅ 🎁 Trial activated. 📺 M3U: ${m3u ?? "not returned"}`);

    return buildResult({
      username,
      password,
      tvPlaylist: m3u,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
