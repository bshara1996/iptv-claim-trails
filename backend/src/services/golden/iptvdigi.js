/**
 * IPTVDigi — free 24-hour trial via WPForms AJAX submission.
 *
 * Site: https://iptvdigi.org/4-hours-free-trial/
 *
 * Flow:
 *   1. POST /wp-admin/admin-ajax.php → submit WPForms trial form.
 *   2. Poll inbox                    → extract M3U links from credentials email.
 */

import { buildResult } from "../../parsing/generators.js";
import { post } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "IPTVDigi";
const BASE_URL = "https://iptvdigi.org";
const PAGE_URL = `${BASE_URL}/4-hours-free-trial/`;
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const FILTER_TEXT = ["IPTV DIGI", "support@iptvdigi.org"];
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds the WPForms form-data payload for the trial request.
const buildPayload = (email) => ({
  "wpforms[fields][1][first]": email.split("@")[0],
  "wpforms[fields][1][last]": email.split("@")[0],
  "wpforms[fields][6]": "Smart TV",
  "wpforms[fields][2]": "",
  "wpforms[fields][8]": email.trim(),
  "wpforms[fields][14]": "123456789",
  "wpforms[fields][3]": "",
  "wpforms[fields][4]": "No",
  "wpforms[id]": "12",
  "wpforms[time_token]":
    "1795036524.91ac0e665aaa8c1912cdca640fc6790fcd56438af11d7844204fc6221795207a",
  page_title: "4 hours free trial",
  page_url: PAGE_URL,
  url_referer: `${BASE_URL}/`,
  page_id: "16",
  "wpforms[post_id]": "16",
  "wpforms[token]": "3a6563896c18678955f0c9322f83d0e8",
  "wpforms[submit]": "wpforms-submit",
  "wpforms[analytics]":
    "eyJzZXNzaW9uX2lkIjoiYThlYzRiNzAtYmIxNi00MTIyLTgyMGQtYmVkN2Q0NDRmOTNiIiwidHJpZ2dlciI6MiwiZm9ybV92aXNpYmxlIjoxLCJwYXlsb2FkIjp7InBhZ2UiOjEsImZpZWxkcyI6W10sInZpZXdEdXJhdGlvbk1zIjoxMTYyNjR9fQ==",
  action: "wpforms_submit",
});

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "iptvdigi",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "golden",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: submit the trial form via WPForms AJAX endpoint
    log(`[${TAG}] 📝 Submitting free trial request...`);
    const { text } = await post(AJAX_URL, null, buildPayload(email), PAGE_URL, {
      origin: BASE_URL,
    });
    log(`[${TAG}] 📡 Response: ${text}`);

    const res = JSON.parse(text || "{}");
    if (res.success === false) {
      const err = Object.values(res.errors ?? {})
        .flat()
        .join("; ");
      throw new Error(`[${TAG}] Form rejected: ${err || "Validation failed"}`);
    }

    // Step 2: poll inbox for credentials email — single M3U link, no VOD
    log(`[${TAG}] 📬 Waiting for credentials email...`);
    const tvPlaylist = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!tvPlaylist)
      log(`[${TAG}] ⚠️ No M3U links found in credentials email.`, "warn");
    else log(`[${TAG}] 📺 ${tvPlaylist}`);

    return buildResult({
      tvPlaylist,
      allM3uLinks: tvPlaylist ? [tvPlaylist] : [],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
