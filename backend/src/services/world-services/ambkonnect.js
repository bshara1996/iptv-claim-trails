/**
 * AmbKonnect — API-based free trial (no email verification).
 *
 * Flow (pure JSON API):
 *   1. POST /api/auth/login with email and password
 *   2. POST /api/checkout/spawn-token to generate checkout token
 *   3. POST /api/checkout/process/{token} to retrieve IPTV credentials
 *
 * Notes:
 *   - No email verification required
 *   - Uses fixed credentials as provided
 *   - Rate limited: 15 minutes between login attempts
 */
import { buildResult, buildM3u } from "../../parsing/generators.js";
import { jsonPost, DEFAULT_UA, createJar } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://ambkonnect.com";
const TAG = "AmbKonnect";
const TRIAL_HOURS = 24;
const FIXED_EMAIL = "bdiyig42926@aiaur.com";
const FIXED_PASSWORD = "123456789";

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "ambkonnect",
    name: "AmbKonnect",
    description: `${TRIAL_HOURS} Hours`,
  },

  // Run the login → token → credential flow for the free trial.
  async execute({ log = () => {} }) {
    const jar = createJar();
    const opts = {
      referer: BASE_URL,
      origin: BASE_URL,
      ua: DEFAULT_UA,
      throwOnError: true,
      timeout: 25_000,
    };

    // Step 1: auth with the fixed trial account to create the session cookie.
    log(`[${TAG}] 🔐 Logging in...`);
    await jsonPost(
      `${BASE_URL}/api/auth/login`,
      jar,
      { email: FIXED_EMAIL, password: FIXED_PASSWORD },
      opts,
    );
    log(`[${TAG}] ✅ Login successful`);

    // Step 2: generate the checkout token for the free-trial order.
    log(`[${TAG}] 🎫 Spawning checkout token...`);
    const { token } = await jsonPost(
      `${BASE_URL}/api/checkout/spawn-token`,
      jar,
      {
        productIds: [62],
        billingCycles: ["free"],
        country: "GB",
        gateway: "free",
        packageName: "Free Trial - 24 Hours",
        amount: 0,
        currencyCode: "USD",
        customFields: {},
        email: FIXED_EMAIL,
      },
      opts,
    );

    // Step 3: redeem the token to fetch the actual IPTV login details.
    log(`[${TAG}] 📺 Retrieving credentials...`);
    const { credentials } = await jsonPost(
      `${BASE_URL}/api/checkout/process/${token}`,
      jar,
      {
        fpRequestId: `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`,
      },
      opts,
    );

    const { username, password, serverUrl } = credentials;
    if (!username || !password)
      throw new Error(`[${TAG}] Failed to extract credentials`);

    log(`[${TAG}] 👤 Username: ${username}`);
    log(`[${TAG}] 🔑 Password: ${password}`);

    // Build the direct-play playlist URL from the returned server + login.
    const m3u = buildM3u(serverUrl, username, password);
    if (m3u) log(`[${TAG}] ✅ 📺 M3U: ${m3u}`);

    return buildResult({
      username,
      password,
      tvPlaylist: m3u,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
