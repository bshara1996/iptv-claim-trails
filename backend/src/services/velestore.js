/**
 * VeleStore (velestore.su) — free IPTV trial via registration.
 *
 * Flow:
 *   1. GET /?do=register  — solve AES-128-CBC DDoS challenge (GET cookie).
 *   2. POST /?do=register (dummy) — solve POST-specific DDoS challenge cookie.
 *   3. POST /?do=register — real registration with reCAPTCHA token.
 *   4. GET /index.php?do=test — activates the 3-day trial (mirrors button click).
 *   5. GET /user/<username>/ — scrape the M3U playlist URLs.
 *
 * reCAPTCHA v2 sitekey: 6LdxN2ElAAAAADqK4-H-y-EB7bcoqFjxDtZy7RFa
 */
import { createDecipheriv } from "crypto";
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../parsing/generators.js";
import { extractPlaylists } from "../parsing/extractors.js";
import {
  createJar,
  mergeCookies,
  cookieStr,
  get,
  request,
  DEFAULT_UA,
} from "../http/cookieClient.js";
import { awaitCaptcha } from "../engine/captcha.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://velestore.su";
const REG_URL = `${BASE_URL}/?do=register`;
const TEST_URL = `${BASE_URL}/index.php?do=test`;
const TAG = "VeleStore";
const TRIAL_HOURS = 72;
const SITEKEY = "6LdxN2ElAAAAADqK4-H-y-EB7bcoqFjxDtZy7RFa";

// ── DDoS solver ───────────────────────────────────────────────────────────────

// Decrypts the AES-128-CBC DDoS challenge cookie from the page HTML and writes
// it into jar. Traces key/IV variable names through the slowAES.decrypt call so
// order is always correct regardless of key rotation or obfuscation style.
function injectSolvedCookie(html, jar) {
  const c3 = /c3=toNumbers\("([a-f0-9]+)"\)/i.exec(html)?.[1];
  const dc =
    /slowAES\.decrypt\s*\(\s*\w+\s*,\s*\d+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/.exec(
      html,
    );
  if (!c3 || !dc) return false;

  // Given a variable name like "a1", trace: a1=toNumbers(a2), a2=atob(<src>)
  // <src> is either a plain literal or an array dereference (_0xf20d[7]).
  // Decode \xNN escapes, then interpret as base64 → 32-char hex → Buffer.
  function resolve(name) {
    const mid = new RegExp(
      String.raw`\b${name}\s*=\s*toNumbers\s*\(\s*(\w+)\s*\)`,
    ).exec(html)?.[1];
    if (!mid) return null;
    let b64 = new RegExp(String.raw`\b${mid}\s*=\s*atob\s*\(\s*([^)]+?)\s*\)`)
      .exec(html)?.[1]
      ?.trim();
    if (!b64) return null;

    // Array dereference: _0xf20d[7] — look up the entry and decode \xNN escapes.
    const ref = /^(\w+)\[(?:\w+\[)?(\d+)\]?\]$/.exec(b64);
    if (ref) {
      const arr = new RegExp(
        String.raw`\bvar\s+${ref[1]}\s*=\s*\[([^\]]+)\]`,
      ).exec(html);
      if (!arr) return null;
      const entry = [...arr[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)][+ref[2]]?.[1];
      if (!entry) return null;
      b64 = entry.replace(/\\x([0-9a-f]{2})/gi, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      );
    } else {
      // Plain literal: strip surrounding quotes.
      b64 = b64.replace(/^["']|["']$/g, "");
    }

    try {
      const hex = Buffer.from(b64, "base64").toString("utf8");
      if (/^[a-f0-9]{32}$/i.test(hex)) return Buffer.from(hex, "hex");
    } catch {}
    return null;
  }

  const KEY = resolve(dc[1]);
  const IV = resolve(dc[2]);
  if (!KEY || !IV) return false;

  const name =
    /document\.cookie\s*=\s*["']([^"'=]+)=["']/i.exec(html)?.[1] ?? "LWvddos";
  const dec = createDecipheriv("aes-128-cbc", KEY, IV);
  dec.setAutoPadding(false);
  jar[name] = Buffer.concat([
    dec.update(Buffer.from(c3, "hex")),
    dec.final(),
  ]).toString("hex");
  return true;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// Shared request options passed to cookieClient for all site requests.
const OPTS = { referer: REG_URL, origin: BASE_URL };

// Single no-redirect POST to REG_URL — needed to capture the DDoS challenge
// cookie that the server sets before issuing a redirect on POST requests.
async function rawPost(jar, body) {
  const res = await fetch(REG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": DEFAULT_UA,
      Cookie: cookieStr(jar),
      Origin: BASE_URL,
      Referer: REG_URL,
    },
    body: new URLSearchParams(body).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  mergeCookies(jar, res);
  return res.text();
}

// Redirect-following fetch that auto-solves any DDoS challenge and retries.
// Each retry injects the newly solved cookie and re-issues the request.
async function fetch$(method, url, jar, body) {
  for (let i = 0; i < 4; i++) {
    const { text, status } = await request(method, url, jar, { body, ...OPTS });
    if (!injectSolvedCookie(text, jar)) return { text, status };
  }
  throw new Error(`[${TAG}] DDoS challenge not resolved after 4 attempts.`);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

// Dummy POST body used only to trigger and capture the POST-specific DDoS cookie.
const DUMMY_BODY = {
  name: "x",
  password1: "x",
  password2: "x",
  email: "x@x.x",
  submit_reg: "submit_reg",
  do: "register",
  "g-recaptcha-response": "dummy",
};

// Primes both GET and POST DDoS cookies before the real registration POST.
// The site issues different c3 ciphertexts for GET vs POST requests.
async function primeDDosCookies(jar, log) {
  log(`[${TAG}] Priming DDoS cookies...`);
  await fetch$("GET", REG_URL, jar, null);
  const challengeHtml = await rawPost(jar, DUMMY_BODY);
  if (injectSolvedCookie(challengeHtml, jar)) await rawPost(jar, DUMMY_BODY);
  log(`[${TAG}] DDoS cookies ready.`);
}

// Submits the registration form and checks the DLE CMS response for errors.
async function register(jar, { username, password, email }, captchaToken, log) {
  log(`[${TAG}] Registering ${username}...`);
  const { text } = await fetch$("POST", REG_URL, jar, {
    name: username,
    password1: password,
    password2: password,
    email,
    submit_reg: "submit_reg",
    do: "register",
    "g-recaptcha-response": captchaToken,
  });

  const err = /class="inform-1">([\s\S]{0,400}?)<\/span>/i
    .exec(text)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (err && !/успешно|success/i.test(err))
    throw new Error(`[${TAG}] Registration error: ${err}`);
  if (/уже (зарег|существует)|already (exist|reg)/i.test(text))
    throw new Error(`[${TAG}] Username or email already registered.`);

  log(`[${TAG}] Registration submitted.`);
}

// Hits the trial-activation endpoint (mirrors the "Получить тест" button AJAX
// call), then loads the profile page and scrapes the M3U playlist URL.
async function activateAndGetM3u(jar, username, log) {
  log(`[${TAG}] Activating trial...`);
  await get(TEST_URL, jar, OPTS);

  log(`[${TAG}] Fetching profile page...`);
  const profileUrl = `${BASE_URL}/user/${encodeURIComponent(username)}/`;
  const { text, status } = await fetch$("GET", profileUrl, jar, null);
  log(`[${TAG}] Profile page status: ${status}`);

  const isLoggedIn = /Привет[,\s]/i.test(text) || /playlist\.m3u/i.test(text);
  if (!isLoggedIn) {
    log(
      `[${TAG}] Not authenticated. Jar: ${Object.keys(jar).join(", ")}`,
      "warn",
    );
    return null;
  }

  // Primary: velestore-specific play path pattern.
  const direct =
    /https?:\/\/[^\s"'<>]+\/(?:play(?:18)?|no)\/[^\s"'<>]+\.m3u8?/i.exec(text);
  if (direct) return direct[0];

  // Fallback: shared extractor.
  return extractPlaylists(text)?.tvPlaylist ?? null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: { id: "velestore", name: "VeleStore", description: "3 Days" },

  async execute({ email, taskId, emitter, log = () => {} }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();

    await primeDDosCookies(jar, log);

    const captchaToken = await awaitCaptcha(
      taskId,
      emitter,
      REG_URL,
      SITEKEY,
      TAG,
      log,
    );
    log(`[${TAG}] reCAPTCHA solved — registering...`);

    await register(jar, { username, password, email }, captchaToken, log);

    const cookieKeys = Object.keys(jar);
    log(`[${TAG}] Cookies: ${cookieKeys.join(", ") || "(none)"}`);

    const session = cookieKeys.find((k) => /phpsessid|sess|sid|auth/i.test(k));
    if (!session)
      throw new Error(
        `[${TAG}] No session cookie — captcha may have been rejected.`,
      );
    log(`[${TAG}] Session via ${session}.`);

    const tvPlaylist = await activateAndGetM3u(jar, username, log);
    if (tvPlaylist) log(`[${TAG}] M3U: ${tvPlaylist}`);

    return buildResult({
      username,
      password,
      tvPlaylist,
      trialHours: TRIAL_HOURS,
      serviceName: "VeleStore",
    });
  },
};
