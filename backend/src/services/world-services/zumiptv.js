/**
 * ZumIPTV — free trial via form POST.
 *
 * Site: https://zumiptv.net/
 *
 * Flow:
 *   1. POST https://trial.zumiptv.net/generate.php → submit trial request.
 *   2. Poll inbox → parse Host / Username / Password from credentials email.
 *   3. Build an Xtream-Codes M3U URL from the extracted credentials.
 *
 * Notes:
 *   - The email delivers plain-text credentials (no M3U links), e.g.:
 *       Host: http://zumhd.site:80
 *       Username: 6142190056
 *       Password: 7992406360
 *   - Sender address varies; filter matches on subject / body content instead.
 */
import { buildResult, buildM3u } from "../../parsing/generators.js";
import { post } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "ZumIPTV";
const TRIAL_URL = "https://trial.zumiptv.net/generate.php";
const ORIGIN = "https://zumiptv.net";
const FILTER_TEXT = ["Zum IPTV", "zumiptv", "zumhd"];
const TRIAL_HOURS = 24;

// Matches Host / Username / Password across the stripped email body.
const CRED_RE =
  /Host[:\s]+(https?:\/\/\S+).*?Username[:\s]+(\S+).*?Password[:\s]+(\S+)/is;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "zumiptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours`,
    group: "best",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit trial form.
    log(`[${TAG}] 📝 Submitting trial request for ${email}...`);
    const { text, status } = await post(
      TRIAL_URL,
      null,
      { action: "submit_trial", email: email.trim(), page_origin: ORIGIN },
      ORIGIN,
    );
    log(`[${TAG}] 🔁 Response [${status}]: ${text}`);

    // Step 2: Poll inbox — email has plain-text credentials, not M3U links.
    // Duck-typed codeRe encodes Host / Username / Password into group 1 as "host|||user|||pass".
    log(
      `[${TAG}] ✅ Trial request submitted. 📬 Waiting for credentials email...`,
    );
    const encoded = await provider.waitForVerificationCodeEmail(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
        codeRe: {
          exec(text) {
            const plain = text.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " ");
            const m = CRED_RE.exec(plain);
            return m ? [null, `${m[1]}|||${m[2]}|||${m[3]}`] : null;
          },
        },
      },
    );

    if (!encoded) {
      log(`[${TAG}] ⚠️ No credentials found in email.`, "warn");
      return buildResult({ trialHours: TRIAL_HOURS, serviceName: TAG });
    }

    // Step 3: Build M3U URL from extracted credentials.
    const [host, username, password] = encoded.split("|||");
    log(`[${TAG}] ✅ Credentials extracted — user: ${username}, host: ${host}`);
    const tvPlaylist = buildM3u(host, username, password);

    return buildResult({
      username,
      password,
      tvPlaylist,
      allM3uLinks: [tvPlaylist],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
