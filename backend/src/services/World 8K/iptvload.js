/**
 * IPTVLoad — WPForms + OTP + status-poll free trial.
 *
 * Site: https://iptvload.org/free-iptv-trial-24-hours/
 *
 * The browser JS (ivl-verify.js) intercepts the form submit and runs an
 * email-OTP gate before the WPForms submission.  We replicate that:
 *
 *   1. GET  /free-iptv-trial-24-hours/   → session cookies + WPForms tokens
 *   2. POST /wp-json/ivl/v1/send         → triggers 6-digit OTP email
 *   3. Poll inbox for the OTP
 *   4. POST /wp-json/ivl/v1/verify       → returns { ok, token } — token = ivl_token
 *   5. POST /wp-admin/admin-ajax.php     → WPForms submission with ivl_token
 *   6. Poll /wp-json/iptvload/v1/trial-status until state === "ready"
 *   7. Extract M3U from details.playlist
 *
 * Steps 1 and 5-6 share the cookie jar (WP session).  Steps 2 and 4 are the
 * email-verification API which the browser calls with credentials:'omit'.
 *
 * Trial duration: 24 hours.
 */
import { buildResult } from "../../parsing/generators.js";
import {
  createJar,
  get,
  post,
  jsonPost,
  cookieStr,
  mergeCookies,
  extractInputValue,
  DEFAULT_UA,
} from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://iptvload.org";
const TRIAL_PAGE = `${BASE_URL}/free-iptv-trial-24-hours/`;
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const SEND_URL = `${BASE_URL}/wp-json/ivl/v1/send`;
const VERIFY_URL = `${BASE_URL}/wp-json/ivl/v1/verify`;
const STATUS_URL = `${BASE_URL}/wp-json/iptvload/v1/trial-status`;

const TAG = "IPTVLoad";
const FILTER_TEXT = ["IPTVLOAD", "iptvload"];
const TRIAL_HOURS = 24;

const STATUS_POLL_TIMEOUT_MS = 120_000;
const STATUS_POLL_INTERVAL_MS = 3_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** GET that carries the shared cookie jar (for the JSON status endpoint). */
async function jarGet(url, jar) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, */*",
      "User-Agent": DEFAULT_UA,
      Referer: TRIAL_PAGE,
      Cookie: cookieStr(jar),
    },
  });
  mergeCookies(jar, res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** Polls trial-status until state === "ready" or the timeout elapses. */
async function pollTrialStatus(jar, log) {
  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const { json } = await jarGet(`${STATUS_URL}?_=${Date.now()}`, jar);

    if (json?.state === "ready") {
      log(`[${TAG}] ✅ Trial provisioned after ${attempt} poll(s).`);
      return json;
    }

    log(
      `[${TAG}] ⏳ Status: ${json?.state ?? "unknown"} (attempt ${attempt}): ${JSON.stringify(json).slice(0, 300)}`,
    );

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) =>
      setTimeout(r, Math.min(STATUS_POLL_INTERVAL_MS, remaining)),
    );
  }

  throw new Error(`[${TAG}] Timed out waiting for trial to become ready.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "iptvload",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "World 8K",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();
    const cleanEmail = email.trim();

    // Use the temp email address directly — each task already gets a fresh
    // throwaway address. IPTVLoad normalizes user+alias@gmail.com back to
    // user@gmail.com when checking duplicates, so aliasing the same base
    // address causes a "This email address has already been used" rejection.
    const submitEmail = cleanEmail;

    const name =
      cleanEmail
        .split("@")[0]
        .replace(/[^a-zA-Z]/g, "")
        .slice(0, 15) || "user";

    // Step 1: GET trial page → extract WPForms tokens + session cookie.
    log(`[${TAG}] 🔐 Loading trial page...`);
    const { text: html, status: pageStatus } = await get(TRIAL_PAGE, jar, {
      referer: `${BASE_URL}/`,
    });
    if (pageStatus >= 400)
      throw new Error(
        `[${TAG}] Failed to load trial page — HTTP ${pageStatus}`,
      );

    log(`[${TAG}] 📄 Page response: HTTP ${pageStatus}, ${html.length} bytes`);
    const timeToken = extractInputValue(html, "wpforms[time_token]");
    const formToken = html.match(/data-token="([^"]+)"/i)?.[1];
    if (!formToken)
      throw new Error(`[${TAG}] Could not extract WPForms form token.`);

    log(
      `[${TAG}] 📄 Tokens: form=${formToken.slice(0, 12)}..., time=${(timeToken ?? "").slice(0, 12)}...`,
    );

    // Step 2: Request verification code → sends OTP email.
    // The browser JS uses credentials:'omit' for this call.
    log(`[${TAG}] 📧 Sending verification code to ${submitEmail}...`);
    const sendRes = await jsonPost(
      SEND_URL,
      null,
      { email: submitEmail },
      { referer: TRIAL_PAGE, origin: BASE_URL, throwOnError: false },
    );

    log(`[${TAG}] 📄 Send response: ${JSON.stringify(sendRes)}`);

    if (sendRes?.bypass && sendRes.token) {
      // Email service is down — server gives the token directly, no OTP needed.
      log(`[${TAG}] ⚡ Email service bypassed — token received directly.`);
      var ivlToken = sendRes.token;
    } else if (sendRes?.ok) {
      // Step 3: Poll inbox for the 6-digit OTP.
      log(`[${TAG}] 📬 Waiting for verification code email...`);
      const otp = await provider.waitForVerificationCodeEmail(credentialStore, {
        filterText: FILTER_TEXT,
        seenIds: inboxSeenIds,
        codeRe: /Your verification code is:\s*[\r\n\s]*(\d{6})/i,
        timeout: 120_000,
      });
      if (!otp)
        throw new Error(
          `[${TAG}] Verification code email did not arrive in time.`,
        );
      log(`[${TAG}] 🔑 OTP received: ${otp}`);

      // Step 4: Verify the OTP → returns the ivl_token.
      log(`[${TAG}] ✅ Verifying code...`);
      const verifyRes = await jsonPost(
        VERIFY_URL,
        null,
        { email: submitEmail, code: otp },
        { referer: TRIAL_PAGE, origin: BASE_URL, throwOnError: false },
      );

      log(`[${TAG}] 📄 Verify response: ${JSON.stringify(verifyRes)}`);

      if (!verifyRes?.ok || !verifyRes.token)
        throw new Error(
          `[${TAG}] Code verification failed: ${verifyRes?.message ?? JSON.stringify(verifyRes).slice(0, 200)}`,
        );

      ivlToken = verifyRes.token;
    } else {
      throw new Error(
        `[${TAG}] Failed to request verification code: ${sendRes?.message ?? JSON.stringify(sendRes).slice(0, 200)}`,
      );
    }

    log(`[${TAG}] 🎫 ivl_token: ${ivlToken.slice(0, 8)}...`);

    // Step 5: Submit the WPForms form with the ivl_token (same jar → session cookie).
    log(`[${TAG}] 📝 Submitting trial form for ${submitEmail}...`);
    await new Promise((r) => setTimeout(r, 2_000)); // anti-spam min-time

    const { text: res, status: formStatus } = await post(
      AJAX_URL,
      jar,
      {
        "wpforms[fields][1]": name,
        "wpforms[fields][2]": submitEmail,
        "wpforms[fields][3]": "",
        "wpforms[fields][4]": "",
        "wpforms[fields][5]": "Other",
        "wpforms[fields][8]": "",
        "wpforms[fields][9]": "Iptv Smarters Pro",
        "wpforms[fields][10]": "",
        "wpforms[fields][23]": "",
        "wpforms[fields][36]": "United States",
        "wpforms[id]": "1019",
        "wpforms[post_id]": "1321",
        "wpforms[time_token]": timeToken ?? "",
        "wpforms[token]": formToken,
        "wpforms[submit]": "wpforms-submit",
        page_title: "Free IPTV Trial",
        page_url: TRIAL_PAGE,
        url_referer: "",
        page_id: "1321",
        ivl_token: ivlToken,
        action: "wpforms_submit",
      },
      TRIAL_PAGE,
    );

    if (formStatus >= 400)
      throw new Error(`[${TAG}] Form submission failed — HTTP ${formStatus}.`);

    log(`[${TAG}] 📄 Form response (HTTP ${formStatus}): ${res.slice(0, 500)}`);

    let formData;
    try {
      formData = JSON.parse(res || "{}");
    } catch {
      formData = {};
    }
    if (formData.success === false) {
      throw new Error(
        `[${TAG}] Form rejected: ${JSON.stringify(formData.data ?? formData).slice(0, 200)}`,
      );
    }
    log(`[${TAG}] ✅ Form accepted.`);

    // Step 6: Poll status endpoint until provisioning completes.
    log(`[${TAG}] ⏳ Waiting for trial credentials to be provisioned...`);
    const statusResponse = await pollTrialStatus(jar, log);

    log(`[${TAG}] 📄 Final status response: ${JSON.stringify(statusResponse)}`);
    // Step 7: Extract the M3U playlist link.
    const details = statusResponse?.details;
    const playlist = details?.playlist ?? null;

    if (!playlist) {
      throw new Error(
        `[${TAG}] Trial ready but no playlist link returned: ${JSON.stringify(statusResponse).slice(0, 200)}`,
      );
    }

    log(`[${TAG}] 🎉 M3U extracted: ${playlist}`);

    return buildResult({
      username: details.username ?? null,
      password: details.password ?? null,
      tvPlaylist: playlist,
      allM3uLinks: [playlist],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
