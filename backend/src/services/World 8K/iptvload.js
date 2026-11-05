/**
 * IPTVLoad — WPForms + OTP + status-poll free trial.
 *
 * Site: https://iptvload.org/free-iptv-trial-24-hours/
 *
 * Flow:
 *   1. GET  /free-iptv-trial-24-hours/  → session cookies + WPForms tokens
 *   2. POST /wp-json/ivl/v1/send        → triggers 6-digit OTP email
 *   3. Poll inbox for OTP
 *   4. POST /wp-json/ivl/v1/verify      → returns ivl_token
 *   5. POST /wp-admin/admin-ajax.php    → WPForms submission with ivl_token
 *   6. Poll /wp-json/iptvload/v1/trial-status until state === "ready"
 *   7. Extract M3U from details.playlist
 *
 * Steps 1 and 5-6 share the cookie jar. Steps 2 and 4 use credentials:'omit'.
 * Retries indefinitely when the email address is already registered.
 */
import { buildResult } from "../../parsing/generators.js";
import {
  createJar,
  get,
  post,
  jsonPost,
  cookieStr,
  mergeCookies,
  DEFAULT_UA,
} from "../../http/cookieClient.js";
import { extractInputValue } from "../../parsing/extractors.js";
import { retryWithFreshEmail } from "../../email/base.js";

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
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

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

    log(`[${TAG}] ⏳ Status: ${json?.state ?? "unknown"} (attempt ${attempt})`);
    await new Promise((r) =>
      setTimeout(r, Math.min(STATUS_POLL_INTERVAL_MS, deadline - Date.now())),
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
    return retryWithFreshEmail(
      async (email) => {
        const jar = createJar();
        const submitEmail = email.trim();
        const name =
          submitEmail
            .split("@")[0]
            .replace(/[^a-zA-Z]/g, "")
            .slice(0, 15) || "user";

        // Step 1: Load trial page → session cookies + WPForms tokens.
        log(`[${TAG}] 🔐 Loading trial page...`);
        const { text: html, status: pageStatus } = await get(TRIAL_PAGE, jar, {
          referer: `${BASE_URL}/`,
        });
        if (pageStatus >= 400)
          throw new Error(
            `[${TAG}] Failed to load trial page — HTTP ${pageStatus}`,
          );

        const timeToken = extractInputValue(html, "wpforms[time_token]");
        const formToken = html.match(/data-token="([^"]+)"/i)?.[1];
        if (!formToken)
          throw new Error(`[${TAG}] Could not extract WPForms form token.`);

        log(
          `[${TAG}] 📄 Tokens: form=${formToken.slice(0, 12)}..., time=${(timeToken ?? "").slice(0, 12)}...`,
        );

        // Step 2: Request OTP email.
        log(`[${TAG}] 📧 Sending verification code to ${submitEmail}...`);
        const sendRes = await jsonPost(
          SEND_URL,
          null,
          { email: submitEmail },
          {
            referer: TRIAL_PAGE,
            origin: BASE_URL,
            throwOnError: false,
          },
        );
        log(`[${TAG}] 📄 Send response: ${JSON.stringify(sendRes)}`);

        let ivlToken;
        if (sendRes?.bypass && sendRes.token) {
          log(`[${TAG}] ⚡ Email service bypassed — token received directly.`);
          ivlToken = sendRes.token;
        } else if (sendRes?.ok) {
          // Step 3: Wait for OTP in inbox.
          log(`[${TAG}] 📬 Waiting for verification code email...`);
          const otp = await provider.waitForVerificationCodeEmail(
            credentialStore,
            {
              filterText: FILTER_TEXT,
              seenIds: inboxSeenIds,
              codeRe: /Your verification code is:\s*[\r\n\s]*(\d{6})/i,
              timeout: 120_000,
            },
          );
          if (!otp)
            throw new Error(
              `[${TAG}] Verification code email did not arrive in time.`,
            );
          log(`[${TAG}] 🔑 OTP received: ${otp}`);

          // Step 4: Verify OTP → ivl_token.
          const verifyRes = await jsonPost(
            VERIFY_URL,
            null,
            { email: submitEmail, code: otp },
            {
              referer: TRIAL_PAGE,
              origin: BASE_URL,
              throwOnError: false,
            },
          );
          log(`[${TAG}] 📄 Verify response: ${JSON.stringify(verifyRes)}`);

          if (!verifyRes?.ok || !verifyRes.token)
            throw new Error(
              `[${TAG}] Code verification failed: ${verifyRes?.message ?? JSON.stringify(verifyRes).slice(0, 200)}`,
            );

          ivlToken = verifyRes.token;
        } else {
          // Rejection at OTP stage — throw to trigger retry.
          const msg = sendRes?.message ?? JSON.stringify(sendRes).slice(0, 200);
          throw new Error(
            `[${TAG}] Failed to request verification code: ${msg}`,
          );
        }

        log(`[${TAG}] 🎫 ivl_token: ${ivlToken.slice(0, 8)}...`);

        // Step 5: Submit WPForms (with anti-spam delay).
        log(`[${TAG}] 📝 Submitting trial form for ${submitEmail}...`);
        await new Promise((r) => setTimeout(r, 2_000));

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
          throw new Error(
            `[${TAG}] Form submission failed — HTTP ${formStatus}.`,
          );

        log(
          `[${TAG}] 📄 Form response (HTTP ${formStatus}): ${res.slice(0, 500)}`,
        );

        let formData;
        try {
          formData = JSON.parse(res || "{}");
        } catch {
          formData = {};
        }

        if (formData.success === false) {
          const errMsg = JSON.stringify(formData.data ?? formData);
          throw new Error(`[${TAG}] Form rejected: ${errMsg.slice(0, 200)}`);
        }

        log(`[${TAG}] ✅ Form accepted.`);

        // Step 6: Poll until trial is provisioned.
        log(
          `[${TAG}] ⏳ Waiting for trial credentials to be provisioned... Total wait time: up to ${STATUS_POLL_TIMEOUT_MS / 1000}s`,
        );
        const statusResponse = await pollTrialStatus(jar, log);

        // Step 7: Extract playlist.
        const details = statusResponse?.details;
        const playlist = details?.playlist ?? null;
        if (!playlist)
          throw new Error(
            `[${TAG}] Trial ready but no playlist link returned: ${JSON.stringify(statusResponse).slice(0, 200)}`,
          );

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
      {
        provider,
        credentialStore,
        email,
        inboxSeenIds,
        log,
        tag: TAG,
        shouldRetry: (err) => {
          const msg = err.message.toLowerCase();
          return msg.includes("used") || msg.includes("already been used");
        },
      },
    );
  },
};
