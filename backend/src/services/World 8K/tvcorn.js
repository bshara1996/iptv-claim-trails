/**
 * TVCorn free trial registration service.
 *
 * Site: https://en.tvcorn.com/trial
 *
 * Flow:
 *   1. GET  /trial            → session cookies + CSRF token
 *   2. POST /trial/sendOtp    → submit name + email, triggers OTP email
 *   3. Poll inbox             → wait for 6-digit verification code
 *   4. POST /trial/verifyOtp  → submit OTP, triggers async account generation
 *   5. Poll /trial/status     → until status === "completed" or timeout
 *
 * Retries indefinitely with a fresh email when the provider is blocked.
 */
import {
  generateUsername,
  parseExpiryDate,
  buildResult,
} from "../../parsing/generators.js";
import { createJar, get, post } from "../../http/cookieClient.js";
import { extractCsrfInlineJs } from "../../parsing/extractors.js";
import { retryWithFreshEmail } from "../../email/base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://en.tvcorn.com";
const CDN_HOST = "http://pro.business-cloud-8.ru";
const TAG = "TVCorn";
const FILTER_TEXT = "tvcorn";
const POLL_INTERVAL = 3_000;
const POLL_TIMEOUT = 120_000;
const OTP_TIMEOUT = 120_000;
const TRIAL_HOURS = 24;

const url = (path) => `${BASE}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (obj) => obj?.message ?? JSON.stringify(obj).slice(0, 200);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pollForAccount(jar, log) {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    const json = JSON.parse(
      (await get(url("/trial/status"), jar)).text || "{}",
    );
    log(`[${TAG}] 🔄 Poll → ${JSON.stringify(json)}`);
    if (json?.status === "completed" && json.data) return json.data;
    if (json?.status === "failed")
      throw new Error(json.data?.message ?? "Account generation failed.");
  }
  throw new Error(`[${TAG}] Account generation timed out.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvcorn",
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
        const name = generateUsername();

        // Step 1: Session cookies + CSRF token.
        const { text: html } = await get(url("/trial"), jar);
        const csrf = extractCsrfInlineJs(html);
        if (!csrf) throw new Error(`[${TAG}] Could not extract CSRF token.`);

        // Step 2: Trigger OTP email.
        const otpBody = new URLSearchParams({ _token: csrf, name, email });
        otpBody.append("countries[]", "world");
        const sendJson = JSON.parse(
          (await post(url("/trial/sendOtp"), jar, otpBody)).text || "{}",
        );

        if (sendJson.status !== "true" && sendJson.status !== true) {
          const msg = brief(sendJson);
          throw new Error(`[${TAG}] OTP request failed: ${msg}`);
        }
        log(`[${TAG}] ✅ 📩 OTP email sent to ${email}`);

        // Step 3: Wait for OTP.
        const code = await provider.waitForVerificationCodeEmail(
          credentialStore,
          {
            filterText: FILTER_TEXT,
            seenIds: new Set(inboxSeenIds),
            timeout: OTP_TIMEOUT,
          },
        );
        if (!code)
          throw new Error(`[${TAG}] Verification code was not received.`);
        log(`[${TAG}] ✅ 🔐 Verification code received: ${code}`);

        // Step 4: Verify OTP.
        const verifyJson = JSON.parse(
          (
            await post(
              url("/trial/verifyOtp"),
              jar,
              new URLSearchParams({ _token: csrf, email, otp: code }),
            )
          ).text || "{}",
        );
        if (verifyJson.status === "false" || verifyJson.status === "error")
          throw new Error(
            `[${TAG}] OTP verification failed: ${brief(verifyJson)}`,
          );
        log(
          `[${TAG}] ⏳ Waiting for account to be generated... Total wait time: up to ${POLL_TIMEOUT / 1000}s`,
        );

        // Step 5: Poll until ready.
        const data = await pollForAccount(jar, log);
        const rawM3u = data.m3u ?? data.m3u_url ?? data.playlist ?? null;
        const m3uLink = rawM3u
          ? rawM3u.replace(/^https?:\/\/[^/]+/, CDN_HOST)
          : null;
        log(`[${TAG}] ✅ Account ready — 📺 M3U: ${m3uLink ?? "not found"}`);

        return buildResult({
          username: data.username,
          password: data.password,
          tvPlaylist: m3uLink,
          allM3uLinks: m3uLink ? [m3uLink] : [],
          expiryDate: parseExpiryDate(data.expiry),
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
          return (
            msg.includes("temporary email") ||
            msg.includes("permanent email") ||
            msg.includes("already been requested") ||
            msg.includes("only one trial")
          );
        },
      },
    );
  },
};
