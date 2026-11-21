/**
 * TVonNet VIP — free 12-hour IPTV trial (dual server).
 *
 * Site: https://www.tvonnet.live
 *
 * Flow:
 *   1. POST /api/auth/send-otp   → send 6-digit OTP code to email
 *   2. Poll inbox                → wait for verification code
 *   3. POST /api/auth/verify-otp → verify code and receive grantToken
 *   4. POST /api/iptv/provision  → provision credentials with grantToken
 *   5. Extract server1 & server2 M3U playlists
 */

import { buildResult } from "../../parsing/generators.js";
import { createJar, jsonPost } from "../../http/cookieClient.js";
import { retryWithFreshEmail } from "../../email/base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "TVonNet VIP";
const BASE_URL = "https://www.tvonnet.live";
const FILTER_TEXT = ["tvonnet", "support@tvonnet.live"];
const TRIAL_HOURS = 24;
const OTP_TIMEOUT = 120_000;

const EMAIL_RETRY_KEYWORDS = [
  "temporary",
  "disposable",
  "strictly blocked",
  "personal email",
  "already",
  "claimed",
  "dot-alias",
  "temp gmail",
  "limit reached",
  "invalid verification code",
  "expired verification code",
  "same browser session",
];

// Helper to post JSON with browser session context.
const postApi = (path, jar, body) =>
  jsonPost(`${BASE_URL}${path}`, jar, body, {
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    throwOnError: true,
  });

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvonnet",
    name: TAG,
    description: `${TRIAL_HOURS} Hours (Dual M3U)`,
    group: "trex",
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

        // Step 1: Request OTP verification code
        log(`[${TAG}] 📤 Requesting OTP for ${email}...`);
        const send = await postApi("/api/auth/send-otp", jar, {
          email: email.trim(),
          intent: "trial",
        });
        if (send?.success === false)
          throw new Error(send.error ?? send.message ?? "Send OTP failed.");
        log(`[${TAG}] 📬 OTP email sent to ${email}`);

        // Step 2: Poll inbox for 6-digit code
        log(`[${TAG}] ⏳ Waiting for OTP code in inbox...`);
        const code = await provider.waitForVerificationCodeEmail(
          credentialStore,
          {
            filterText: FILTER_TEXT,
            seenIds: inboxSeenIds,
            timeout: OTP_TIMEOUT,
          },
        );
        if (!code)
          throw new Error(`[${TAG}] Verification code was not received.`);
        log(`[${TAG}] 🔑 Code received: ${code}`);

        // Step 3: Verify OTP code
        log(`[${TAG}] 🔐 Verifying OTP code...`);
        const verify = await postApi("/api/auth/verify-otp", jar, {
          email: email.trim(),
          code: String(code).trim(),
          intent: "trial",
        });
        if (!verify?.success || !verify?.grantToken)
          throw new Error(
            verify?.error ?? verify?.message ?? "OTP verification failed.",
          );
        log(`[${TAG}] ✅ Email verified.`);

        // Step 4: Provision 12H trial credentials
        log(`[${TAG}] ⚙️ Provisioning ${TRIAL_HOURS}H trial credentials...`);
        const res = await postApi("/api/iptv/provision", jar, {
          panel: "both",
          duration: "12h",
          connections: 1,
          fullName: "VIP Guest",
          email: email.trim(),
          device: "Amazon Fire TV Stick 4K",
          paymentMethod: "Verified 12H Trial Pass",
          includeAdult: false,
          grantToken: verify.grantToken,
        });
        if (!res?.success)
          throw new Error(res?.error ?? res?.message ?? "Provisioning failed.");

        // Step 5: Extract server1 & server2 M3U URLs
        const s1 = res.server1?.m3uUrl ?? null;
        const s2 = res.server2?.m3uUrl ?? null;
        const allM3uLinks = [s1, s2].filter(Boolean);

        if (s1) log(`[${TAG}] 📺 Server 1: ${s1}`);
        if (s2) log(`[${TAG}] 📺 Server 2: ${s2}`);

        const usernames = [res.server1?.username, res.server2?.username].filter(
          Boolean,
        );
        const passwords = [res.server1?.password, res.server2?.password].filter(
          Boolean,
        );

        return {
          ...buildResult({
            username: usernames.join(" | ") || null,
            password: passwords.join(" | ") || null,
            tvPlaylist: allM3uLinks.join("\n"),
            allM3uLinks,
            trialHours: TRIAL_HOURS,
            serviceName: TAG,
            note:
              res.message ??
              `Dual-server trial activated (${allM3uLinks.length} M3U playlists).`,
          }),
          server1: res.server1,
          server2: res.server2,
          server1M3u: s1,
          server2M3u: s2,
          magicLink: res.magicLink ?? null,
          orderId: res.orderId ?? null,
          parentalPin: res.parentalPin ?? null,
        };
      },
      {
        provider,
        credentialStore,
        email,
        inboxSeenIds,
        log,
        tag: TAG,
        shouldRetry: (err) => {
          const msg = (err.message ?? "").toLowerCase();
          return EMAIL_RETRY_KEYWORDS.some((k) => msg.includes(k));
        },
      },
    );
  },
};
