/**
 * OgoTV — API/fetch-based free trial.
 *
 * Flow:
 *   1. GET  /login/                               → session cookie + csrf_token
 *   2. POST /auth/email-step/ { action:lookup }   → register/login mode
 *   3. POST /auth/email-step/ { action:complete } → create account
 *   4. Poll inbox                                 → wait for 6-digit code
 *   5. POST /auth/email-step/ { action:verify }   → confirm code
 *   6. GET  /client/                              → dashboard
 *   7. POST /client/ activate_trial=1             → activate 24-hour trial
 *   8. POST /api/playlist-builder/ action=prepare → kick off playlist build
 *   9. GET  /api/player-connect/?mode=xtream      → Xtream creds (retried)
 *  10. Build TV: Xtream M3U+ + direct .m3u8 · VOD: /p/{user}/vod.m3u8
 */
import { buildResult, buildM3u } from "../../parsing/generators.js";
import { extractPlaylists, extractM3uLinks } from "../../parsing/extractors.js";
import { createJar, get, post, jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://ogotv.com";
const TAG = "OgoTV (Gmails)";
const FILTER_TEXT = ["ogo", "noreply@ogotv.com"];
const TRIAL_HOURS = 24;
const XTREAM_TRIES = 5;
const XTREAM_WAIT = 1_500; // ms between Xtream API retries

// ── Helpers ───────────────────────────────────────────────────────────────────

// JSON POST to /auth/email-step/ with OgoTV-specific headers.
const authPost = (jar, body) =>
  jsonPost(`${BASE}/auth/email-step/`, jar, body, {
    referer: `${BASE}/login/`,
    extraHeaders: { "Accept-Language": "ru-RU,ru;q=0.9" },
    throwOnError: false,
  });

// CSRF from login page hidden input (id="authCsrfToken").
const authCsrf = (h) =>
  /id="authCsrfToken"[^>]*value="([^"]+)"/.exec(h)?.[1] ??
  /value="([^"]+)"[^>]*id="authCsrfToken"/.exec(h)?.[1] ??
  null;

// CSRF from dashboard inline JS (window.clientCsrfToken).
const clientCsrf = (h) =>
  /clientCsrfToken\s*=\s*"([^"]+)"/.exec(h)?.[1] ??
  /name="csrf_token"[^>]*value="([^"]+)"/.exec(h)?.[1] ??
  null;

// Anti-bot timestamp — subtracts s seconds from the page's form start value.
const startedAt = (h, s = 45) => {
  const m = /id="authStartedAt"[^>]*value="(\d+)"/.exec(h);
  return String(m ? +m[1] - s : Math.floor(Date.now() / 1000) - s);
};

// Extracts the playlist username from a /p/{user}.m3u8 URL.
const ogoUser = (url) =>
  /\/p\/([^/.]+)(?:\.m3u8|\/|$)/.exec(url ?? "")?.[1] ?? null;

// Builds all three canonical playlist URLs from Xtream creds.
// TV = Xtream M3U+ + direct .m3u8 (newline-stacked for ResultsTable).
// VOD = /p/{user}/vod.m3u8.
const ogoLinks = (xHost, xUser, xPass) => ({
  tvPlaylist: [buildM3u(xHost, xUser, xPass), `${BASE}/p/${xUser}.m3u8`]
    .filter(Boolean)
    .join("\n"),
  vodPlaylist: `${BASE}/p/${xUser}/vod.m3u8`,
});

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "ogotv",
    name: "OgoTV (Gmails)",
    description: `${TRIAL_HOURS} Hours`,
    group: "russian",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();
    const PASSWORD = "123456";

    // Step 1: Load login page — session cookie + CSRF.
    const { text: loginHtml } = await get(`${BASE}/login/`, jar);
    const csrf = authCsrf(loginHtml);
    if (!csrf) throw new Error(`[${TAG}] CSRF not found`);

    // Step 2: Determine whether the email is a new or existing account.
    const lookup = await authPost(jar, {
      action: "lookup",
      email,
      website: "",
      form_started_at: startedAt(loginHtml),
      csrf_token: csrf,
    });
    if (!lookup.success)
      throw new Error(`[${TAG}] Lookup failed: ${lookup.error}`);

    // Step 3: Register or log in — triggers a verification email on new accounts.
    const complete = await authPost(jar, {
      action: "complete",
      mode: lookup.mode ?? "register",
      email,
      password: PASSWORD,
      csrf_token: csrf,
      source: "trial",
      website: "",
      form_started_at: startedAt(loginHtml, 60),
    });
    if (!complete.pending_verification && !complete.success)
      throw new Error(`[${TAG}] Auth failed: ${complete.error}`);

    // Steps 4+5: Verify the 6-digit code sent to inbox (new registrations only).
    if (complete.pending_verification) {
      log(`[${TAG}] 📬 Polling inbox for verification code…`);
      const code = await provider.waitForVerificationCodeEmail(
        credentialStore,
        {
          filterText: FILTER_TEXT,
          seenIds: new Set(inboxSeenIds),
          timeout: 120_000,
        },
      );
      if (!code) throw new Error(`[${TAG}] Verification code not received.`);
      log(`[${TAG}] 🔑 Code: ${code}`);

      const verify = await authPost(jar, {
        action: "verify",
        email,
        code,
        csrf_token: csrf,
        source: "trial",
      });
      if (!verify.success)
        throw new Error(`[${TAG}] Verify failed: ${verify.error}`);
    }

    // Step 6: Load dashboard — redirect to /login/ means the session is invalid.
    const { text: dashHtml, finalUrl } = await get(`${BASE}/client/`, jar);
    if (finalUrl.includes("login"))
      throw new Error(`[${TAG}] Not authenticated`);

    // Step 7: Activate the trial if not already active.
    let activateHtml = dashHtml;
    let dashCsrf = clientCsrf(dashHtml);

    if (dashHtml.includes("activate_trial")) {
      if (!dashCsrf) throw new Error(`[${TAG}] Dashboard CSRF not found`);
      log(`[${TAG}] 🎁 Activating trial…`);
      ({ text: activateHtml } = await post(
        `${BASE}/client/`,
        jar,
        { csrf_token: dashCsrf, activate_trial: "1" },
        `${BASE}/client/`,
      ));
      dashCsrf = clientCsrf(activateHtml) ?? dashCsrf;
    }

    // Step 8: Trigger playlist preparation via the builder API.
    // /api/player-connect/ refuses creds until this has been called first.
    let tvPlaylist = null;
    let vodPlaylist = null;
    let builderLink = null;

    if (dashCsrf) {
      log(`[${TAG}] 🛠️ Triggering playlist preparation…`);
      const { text: prep } = await post(
        `${BASE}/api/playlist-builder/`,
        jar,
        { csrf_token: dashCsrf, action: "prepare", retry: "1", restart: "1" },
        `${BASE}/client/`,
      );
      let prepJson = null;
      try {
        prepJson = JSON.parse(prep);
      } catch {
        /* html */
      }

      builderLink = prepJson
        ? (extractM3uLinks(prepJson)[0] ??
          extractPlaylists(JSON.stringify(prepJson))?.tvPlaylist)
        : extractPlaylists(prep)?.tvPlaylist;

      if (builderLink) log(`[${TAG}] 📋 Builder link: ${builderLink}`);
    }

    // Step 9: Fetch Xtream credentials — retry until playlist is ready.
    // The server returns "Сначала дождитесь подготовки" until step 8 finishes.
    for (let i = 1; i <= XTREAM_TRIES; i++) {
      if (i > 1) {
        log(
          `[${TAG}] ⏳ Waiting ${XTREAM_WAIT / 1000}s… (${i}/${XTREAM_TRIES})`,
        );
        await new Promise((r) => setTimeout(r, XTREAM_WAIT));
      }
      log(`[${TAG}] 🔗 Xtream API (attempt ${i}/${XTREAM_TRIES})…`);

      try {
        const { text: raw } = await get(
          `${BASE}/api/player-connect/?mode=xtream`,
          jar,
          { extraHeaders: { Accept: "application/json, text/html, */*" } },
        );
        let xt = null;
        try {
          xt = JSON.parse(raw);
        } catch {
          /* html */
        }

        if (xt && !xt.error) {
          const xUser = xt.username ?? xt.user ?? xt.login ?? null;
          const xPass = xt.password ?? xt.pass ?? xt.passwd ?? null;
          const xHost = xt.server ?? xt.host ?? xt.url ?? xt.stream_url ?? null;
          if (xHost && xUser && xPass) {
            ({ tvPlaylist, vodPlaylist } = ogoLinks(xHost, xUser, xPass));
            break;
          }
          log(`[${TAG}] ⚠️ Incomplete creds: ${JSON.stringify(xt)}`, "warn");
          break;
        } else if (xt?.error) {
          log(`[${TAG}] ⚠️ ${xt.error}`, "warn");
          if (!/подготов|wait|prepar/i.test(xt.error)) break; // non-retriable error
        } else {
          tvPlaylist = extractPlaylists(raw)?.tvPlaylist ?? null;
          if (tvPlaylist) break;
        }
      } catch (err) {
        log(`[${TAG}] ⚠️ Xtream request failed: ${err.message}`, "warn");
        break;
      }
    }

    // Step 10: If Xtream API yielded nothing, fall back to the builder link.
    // The builder URL encodes the playlist username — use it to derive the VOD link.
    if (!tvPlaylist) {
      log(`[${TAG}] 🔄 Falling back to builder link…`);
      const direct =
        builderLink ??
        extractPlaylists(activateHtml)?.tvPlaylist ??
        extractPlaylists((await get(`${BASE}/client/`, jar)).text)
          ?.tvPlaylist ??
        null;
      if (direct) {
        tvPlaylist = direct;
        const user = ogoUser(direct);
        if (user) vodPlaylist = `${BASE}/p/${user}/vod.m3u8`;
      }
    }

    if (tvPlaylist) {
      const [xtreamUrl, directUrl] = tvPlaylist.split("\n");
      log(`[${TAG}] 📺 TV: ${directUrl ?? xtreamUrl}`);
      if (vodPlaylist) log(`[${TAG}] 🍿 VOD: ${vodPlaylist}`);
      if (directUrl) log(`[${TAG}] 🗂️ M3U: ${xtreamUrl}`);
    } else {
      log(`[${TAG}] ⚠️ M3U not found.`, "warn");
    }

    return buildResult({
      username: email,
      password: PASSWORD,
      tvPlaylist,
      vodPlaylist,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};