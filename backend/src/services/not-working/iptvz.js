/**
 * IPTVZ — free trial.
 * Site: https://www.iptvz.net/free-trial/
 *
 * Flow:
 *   1. POST /api/trial/request → submit email + plan.
 *   2. Poll inbox              → extract trial-activate link from verification email.
 *   3. GET the activate link   → confirm the trial.
 *   4. Poll inbox again        → extract M3U links from the credentials email.
 */
import { buildResult } from "../../parsing/generators.js";
import { createJar, get, jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "IPTVZ";
const API_URL = "https://admin.iptvz.net/api/trial/request";
const PAGE_URL = "https://www.iptvz.net/free-trial/";
const FILTER_TEXT = ["iptvz"];
const VERIFY_PATTERN = /trial-activate\?token=/i;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "iptvz",
    name: TAG,
    description: "Free trial",
    group: "not working",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Shared seen-set: ids processed by poll 1 stay marked for poll 2 so the
    // verification email is never re-read as the credentials email.
    const seen = new Set(inboxSeenIds);

    // Step 1: request the trial — credentials arrive by email, not in the response.
    log(`[${TAG}] 📝 Submitting free trial request...`);
    const raw = await jsonPost(
      API_URL,
      null,
      {
        email: email.trim(),
        subscriptionType: "Standard",
        magMac: "",
        locale: "en",
        page: "/free-trial/",
      },
      { referer: PAGE_URL },
    );
    log(`[${TAG}] 📡 Response: ${JSON.stringify(raw)}`);

    // Step 2: poll inbox for the verification email and extract the activate link.
    log(`[${TAG}] 📬 Waiting for verification email...`);
    const activateLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        pattern: VERIFY_PATTERN,
        seenIds: seen,
        timeout: 120_000,
      },
    );
    if (!activateLink)
      throw new Error(`[${TAG}] Verification email not received.`);

    // Step 3: open the activation link — may set cookies or redirect to a confirm page.
    log(`[${TAG}] 🔐 Activating trial: ${activateLink}`);
    const { status, finalUrl } = await get(activateLink, createJar(), {
      referer: PAGE_URL,
    });
    log(`[${TAG}] 📡 Activation page: HTTP ${status} → ${finalUrl}`);

    // Step 4: poll inbox again for the credentials email containing the M3U link.
    log(`[${TAG}] 📬 Waiting for credentials email...`);
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: seen,
        timeout: 120_000,
      },
    );

    if (playlists.allM3uLinks.length) {
      log(`[${TAG}] 📺 ${playlists.tvPlaylist ?? playlists.allM3uLinks[0]}`);
    } else {
      log(`[${TAG}] ⚠️ No M3U links found in credentials email.`, "warn");
    }

    return buildResult({
      playlists,
      serviceName: TAG,
    });
  },
};
