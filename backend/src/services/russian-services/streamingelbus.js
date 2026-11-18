/**
 * StreamingElbus (streaming-elbrus.su) — free IPTV trial via email registration.
 *
 * Flow:
 *   1. GET  /register            → solve AES-128-CBC DDoS challenge (LWvddos cookie + PHPSESSID).
 *   2. awaitCaptcha              → prompt user to solve reCAPTCHA v2 in UI.
 *   3. POST /register_post       → submit registration form.
 *   4. Poll inbox                → extract verification link.
 *   5. GET  /verify_email?token= → confirm email address.
 *   6. Build playlist URLs       → Xtream-Codes M3U links.
 *
 * Retries with a fresh email when { ok: false, message: "email exists" }.
 */
import { createDecipheriv } from "crypto";
import {
  buildResult,
  generatePassword,
  generateUsername,
} from "../../parsing/generators.js";
import { createJar, get, jsonPost } from "../../http/cookieClient.js";
import { awaitCaptcha } from "../../engine/captcha.js";
import { retryWithFreshEmail } from "../../email/base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://streaming-elbrus.su";
const PLAYLIST_HOST = "https://p.rapidnas.org";
const TAG = "StreamingElbus (Gmail)";
const TRIAL_HOURS = 24;
const SITEKEY = "6LcahZMfAAAAANSOPM4UWbr-dZpwBkgi347dFTUM";
const FILTER_TEXT = ["yosso", "mail@streaming-elbrus.su", "elbrus"];
const EMAIL_TAKEN = "email exists";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Decrypts the slowAES challenge: sets dynamic LWvddos cookie and returns redirect URL.
function solveDdos(html, jar) {
  const cookieName =
    /document\.cookie\s*=\s*"([^=]+)=/i.exec(html)?.[1] ?? "LWvddos-kn";
  const hexes = [...html.matchAll(/toNumbers\("([a-f0-9]+)"\)/gi)].map(
    (m) => m[1],
  );
  if (hexes.length < 3) return null;

  const [key, iv, cipher] = hexes.slice(0, 3).map((h) => Buffer.from(h, "hex"));
  const d = createDecipheriv("aes-128-cbc", key, iv);
  d.setAutoPadding(false);
  jar[cookieName] = Buffer.concat([d.update(cipher), d.final()]).toString(
    "hex",
  );

  return /location\.href="([^"]+)"/i.exec(html)?.[1] ?? null;
}

// Follows DDoS-challenge redirect hops to prime anti-DDoS cookie and PHPSESSID.
async function primeSession(jar, log) {
  log(`[${TAG}] 🔒 Bypassing DDoS protection…`);
  let url = `${BASE}/register`;
  for (let i = 0; i < 4; i++) {
    const { text } = await get(url, jar);
    const next = solveDdos(text, jar);
    if (!next) return;
    url = next;
  }
  throw new Error(
    `[${TAG}] Failed to bypass DDoS protection (max hops reached).`,
  );
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "streamingelbus",
    name: "StreamingElbus (Gmail)",
    description: `${TRIAL_HOURS} Hours`,
    group: "russian",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    taskId,
    emitter,
    log = () => {},
  }) {
    return retryWithFreshEmail(
      async (currentEmail) => {
        const username = generateUsername();
        const password = generatePassword();
        const jar = createJar();

        // Step 1: Prime session — solve anti-DDoS challenge.
        await primeSession(jar, log);

        // Step 2: Solve reCAPTCHA v2.
        const captchaToken = await awaitCaptcha(
          taskId,
          emitter,
          `${BASE}/register`,
          SITEKEY,
          TAG,
          log,
        );

        // Step 3: Submit registration form.
        const res = await jsonPost(
          `${BASE}/register_post`,
          jar,
          {
            login: username,
            email: currentEmail,
            password,
            "g-recaptcha-response": captchaToken,
          },
          { referer: `${BASE}/register`, origin: BASE, throwOnError: false },
        );
        log(`[${TAG}] 📡 Registration response: ${JSON.stringify(res)}`);
        if (!res?.ok) {
          throw new Error(
            res?.message ||
              (res && Object.keys(res).length
                ? JSON.stringify(res)
                : "Empty response from server (DDoS protection blocked request)"),
          );
        }

        // Step 4: Poll inbox for verification link.
        log(
          `[${TAG}] ✅ Registered (ID: ${res.id}) ➜ 📩 Polling for verification email…`,
        );
        const link = await provider.waitForEmailAndExtractLink(
          credentialStore,
          {
            filterText: FILTER_TEXT,
            pattern: /streaming-elbrus\.su\/verify_email\?token=/i,
            seenIds: new Set(inboxSeenIds),
            timeout: 120_000,
          },
        );
        if (!link) throw new Error(`[${TAG}] Verification email not received.`);
        log(`[${TAG}] 🔑 Verification link received: ${link}`);

        // Step 5: Confirm email address.
        const token = new URL(link).searchParams.get("token");
        await get(
          `${BASE}/verify_email?token=${encodeURIComponent(token)}`,
          jar,
          { referer: `${BASE}/register` },
        );

        // Step 6: Build Xtream-Codes playlist URLs.
        const tvPlaylist = `${PLAYLIST_HOST}/playlist/${username}/${password}/playlist.m3u8`;
        const vodPlaylist = `${PLAYLIST_HOST}/vod/${username}/${password}/a/p.m3u8`;
        log(`[${TAG}] 📺 TV: ${tvPlaylist}`);
        log(`[${TAG}] 🍿 VOD: ${vodPlaylist}`);

        return {
          ...buildResult({
            username,
            password,
            tvPlaylist,
            vodPlaylist,
            trialHours: TRIAL_HOURS,
            serviceName: TAG,
          }),
          email: currentEmail,
        };
      },
      {
        provider,
        credentialStore,
        email,
        inboxSeenIds,
        log,
        tag: TAG,
        shouldRetry: (err) => err.message?.toLowerCase().includes(EMAIL_TAKEN),
      },
    );
  },
};
