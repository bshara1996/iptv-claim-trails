/**
 * TVBoom (tvboom.vip) — free 24-hour IPTV trial via registration.
 *
 * The site runs DataLife Engine (DLE), the same PHP CMS used by velestore.su.
 *
 * Flow:
 *   1. GET  /register              → PHPSESSID cookie + ToS acceptance form
 *   2. POST /register              → accept ToS (do=register&dle_rules_accept=yes)
 *                                    → actual registration form with reCAPTCHA v2
 *   3. Emit captcha_challenge      → await reCAPTCHA token from frontend
 *   4. POST /register              → submit name / email / password / captcha token
 *   5. GET  /index.php?do=test     → activate 24-hour trial (mirrors in-page button)
 *   6. GET  /user/<username>/      → scrape M3U playlist URL from profile page
 *
 * reCAPTCHA v2 sitekey: 6LdDnVUqAAAAADwIxsZPYsDmLDdEsR979dxwhYyc
 */
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../parsing/generators.js";
import { extractPlaylists } from "../parsing/extractors.js";
import { createJar, get, post, stripHtml } from "../http/cookieClient.js";
import { awaitCaptcha } from "../engine/captcha.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://tvboom.vip";
const REGISTER_URL = `${BASE_URL}/register`;
const TEST_URL = `${BASE_URL}/index.php?do=test`;
const TAG = "TVBoom";
const TRIAL_HOURS = 24;
const SITEKEY = "6LdDnVUqAAAAADwIxsZPYsDmLDdEsR979dxwhYyc";

// ── Steps ─────────────────────────────────────────────────────────────────────

// Step 1+2: GET the register page to pick up PHPSESSID, then POST the ToS
// acceptance to advance to the actual registration form.
async function acceptTos(jar, log) {
  log(`[${TAG}] Loading registration page…`);
  await get(REGISTER_URL, jar);

  log(`[${TAG}] Accepting terms of service…`);
  const { text } = await post(
    REGISTER_URL,
    jar,
    { do: "register", dle_rules_accept: "yes" },
    REGISTER_URL,
  );
  return text;
}

// Step 4: POST the real registration form with the reCAPTCHA token.
// Returns the response HTML so callers can check for errors.
async function register(jar, { username, password, email }, captchaToken, log) {
  log(`[${TAG}] Submitting registration for ${email}…`);
  const { text } = await post(
    REGISTER_URL,
    jar,
    {
      name: username,
      email,
      password1: password,
      password2: password,
      submit_reg: "submit_reg",
      do: "register",
      "g-recaptcha-response": captchaToken,
    },
    REGISTER_URL,
  );

  // DLE embeds inline error messages in a span with class "inform-1".
  const errMatch = /class="inform-1">([\s\S]{0,400}?)<\/span>/i.exec(text);
  if (errMatch) {
    const errText = errMatch[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/успешно|success/i.test(errText))
      throw new Error(`[${TAG}] Registration error: ${errText}`);
  }

  if (/уже (зарег|существует)|already (exist|reg)/i.test(text))
    throw new Error(`[${TAG}] Username or email already registered.`);

  if (/reCAPTCHA|captcha.*invalid|неверн.*капч/i.test(text))
    throw new Error(`[${TAG}] reCAPTCHA rejected — please try again.`);

  log(`[${TAG}] ✅ Registration submitted.`);
  return text;
}

// Step 5: Hit the trial-activation endpoint — mirrors the "Получить тест"
// button AJAX call on the dashboard.
async function activateTrial(jar, log) {
  log(`[${TAG}] Activating 24-hour trial…`);
  await get(TEST_URL, jar);
  log(`[${TAG}] ✅ Trial activation request sent.`);
}

// Step 6: Fetch the user profile page and extract the M3U playlist URL.
// DLE profiles live at /user/<username>/ — same pattern as velestore.su.
async function fetchM3u(jar, username, log) {
  const profileUrl = `${BASE_URL}/user/${encodeURIComponent(username)}/`;
  log(`[${TAG}] Fetching profile page: ${profileUrl}`);
  const { text, status } = await get(profileUrl, jar);
  log(`[${TAG}] Profile status: ${status}`);

  // Primary: shared M3U / playlist extractor.
  const playlists = extractPlaylists(text);
  if (playlists?.tvPlaylist) return playlists.tvPlaylist;

  // Fallback: DLE billing panel often embeds the M3U in a data attribute or
  // inline table cell — scan for any http(s) URL ending in .m3u or .m3u8.
  const directMatch = /https?:\/\/[^\s"'<>]+\.m3u8?(?:[?#][^\s"'<>]*)?/i.exec(
    text,
  );
  if (directMatch) return directMatch[0];

  // Log relevant lines to help diagnose if the M3U is present but unparsed.
  const relevantLines = text
    .split("\n")
    .filter((l) =>
      /http|url|link|playlist|stream|server|port|user|pass|trial|m3u|xtream/i.test(
        l,
      ),
    )
    .map((l) => stripHtml(l).slice(0, 300))
    .filter((l) => l.length > 3)
    .join("\n");

  if (relevantLines)
    log(
      `[${TAG}] M3U not found. Relevant profile lines:\n${relevantLines}`,
      "warn",
    );
  else
    log(`[${TAG}] M3U not found — profile page has no relevant URLs.`, "warn");

  return null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvboom",
    name: "TVBoom",
    description: "24 Hours",
  },

  async execute({ email, taskId, emitter, log = () => {} }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();

    // Steps 1+2: Load the registration page and accept ToS.
    await acceptTos(jar, log);

    // Step 3: Pause and ask the frontend to solve the reCAPTCHA.
    const captchaToken = await awaitCaptcha(
      taskId,
      emitter,
      REGISTER_URL,
      SITEKEY,
      TAG,
      log,
    );
    log(`[${TAG}] reCAPTCHA solved — proceeding with registration…`);

    // Step 4: Submit the registration form.
    await register(jar, { username, password, email }, captchaToken, log);

    // Step 5: Activate the trial.
    await activateTrial(jar, log);

    // Step 6: Scrape the profile page for the M3U link.
    const tvPlaylist = await fetchM3u(jar, username, log);
    if (tvPlaylist) log(`[${TAG}] ✅ M3U: ${tvPlaylist}`);

    return buildResult({
      username,
      password,
      tvPlaylist,
      trialHours: TRIAL_HOURS,
      serviceName: "TVBoom",
    });
  },
};
