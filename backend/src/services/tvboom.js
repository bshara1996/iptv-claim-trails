/**
 * TVBoom — API/scraping-based free trial.
 *
 * Flow:
 *   1. GET /register    → accept terms if present, parse hidden form fields.
 *   2. Emit captcha_challenge, wait for frontend reCAPTCHA token.
 *   3. POST registration form with captcha token.
 *   4. Poll inbox for confirmation email, extract validation link.
 *   5. GET validation link to activate account.
 *   6. GET /cabinet and trigger GetTest to activate the 24-hour trial.
 */
import { generateUsername, generatePassword } from "../parsing/generators.js";
import { buildResult } from "../parsing/result.js";
import { createJar, get, post, errSnippet } from "../http/cookieClient.js";
import { awaitCaptcha } from "../engine/captcha.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://tvboom.vip";
const TAG = "TVBoom";
const TRIAL_HOURS = 24;
const SITEKEY = "6LdDnVUqAAAAADwIxsZPYsDmLDdEsR979dxwhYyc";

// Matches the TVBoom account validation link; tolerates &amp; HTML-encoding.
const VALIDATION_LINK_RE =
  /https?:\/\/tvboom\.vip\/index\.php\?do=register(?:&|&amp;)doaction=validating(?:&|&amp;)id=[a-zA-Z0-9_|=~%-]+/i;

// ── Steps ─────────────────────────────────────────────────────────────────────

// Loads the registration page. If a terms acceptance form is present,
// submits it first and returns the registration form HTML.
async function acceptRules(jar, log) {
  log(`[${TAG}] Loading registration page…`);
  const regUrl = `${BASE}/index.php?do=register`;
  const { text: rulesHtml } = await get(regUrl, jar);

  const hasRulesForm =
    /name=["']bbcodes["']|type=["']submit["'][^>]*bbcodes|bbcodes[^>]*type=["']submit["']/i.test(
      rulesHtml,
    ) || /do=register.*doaction=reg/i.test(rulesHtml);

  if (!hasRulesForm) return rulesHtml;

  log(`[${TAG}] Accepting terms…`);
  // Collect all hidden inputs from the terms form to forward with the submission.
  const hiddenBody = {};
  let m;
  const hiddenTagRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  while ((m = hiddenTagRe.exec(rulesHtml)) !== null) {
    const nameM = /name=["']([^"']+)["']/.exec(m[0]);
    const valM = /value=["']([^"']*)["']/.exec(m[0]);
    if (nameM) hiddenBody[nameM[1]] = valM?.[1] ?? "";
  }
  hiddenBody["agree"] = "1";
  hiddenBody["submit"] = "1";

  const { text: regFormHtml } = await post(regUrl, jar, hiddenBody, regUrl);
  return regFormHtml;
}

// Accepts the terms (if needed), solves the captcha, then submits the registration form.
async function register(jar, username, email, password, taskId, emitter, log) {
  const regUrl = `${BASE}/index.php?do=register`;
  const regFormHtml = await acceptRules(jar, log);

  // Collect hidden form fields to forward alongside the registration data.
  const formBody = {};
  const hiddenTagRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = hiddenTagRe.exec(regFormHtml)) !== null) {
    const nameM = /name=["']([^"']+)["']/.exec(m[0]);
    const valM = /value=["']([^"']*)["']/.exec(m[0]);
    if (nameM) formBody[nameM[1]] = valM?.[1] ?? "";
  }
  Object.assign(formBody, {
    name: username,
    email,
    password1: password,
    password2: password,
    submit: "Зарегистрироваться",
  });

  const token = await awaitCaptcha(
    taskId,
    emitter,
    `${BASE}/index.php?do=register`,
    SITEKEY,
    TAG,
    log,
  );
  log(`[${TAG}] reCAPTCHA solved — submitting registration…`);
  formBody["g-recaptcha-response"] = token;

  const { text: resultHtml, finalUrl } = await post(
    regUrl,
    jar,
    formBody,
    regUrl,
  );

  if (
    /ошибк|error|already|already registered/i.test(resultHtml) &&
    finalUrl.includes("register")
  )
    throw new Error(`[${TAG}] Registration failed — ${errSnippet(resultHtml)}`);

  log(`[${TAG}] ✅ Registration submitted`);
}

// Opens the cabinet page and triggers the GetTest trial activation link.
async function activateTrial(jar, log) {
  const { text: cabinetHtml } = await get(`${BASE}/index.php?do=cabinet`, jar);

  // Look for a GetTest href or onclick — if not found fall back to a direct AJAX call.
  const testLinkM =
    /href=["']([^"']*GetTest[^"']*)["']/i.exec(cabinetHtml) ??
    /onclick=["'][^"']*GetTest\(["']?([^"',)]+)/i.exec(cabinetHtml);

  if (testLinkM) {
    const testUrl = testLinkM[1].startsWith("http")
      ? testLinkM[1]
      : `${BASE}/${testLinkM[1].replace(/^\//, "")}`;
    await get(testUrl, jar);
    log(`[${TAG}] ✅ Trial activation requested`);
  } else {
    await get(`${BASE}/index.php?do=cabinet&doaction=GetTest`, jar);
    log(`[${TAG}] ✅ Trial activation requested (via AJAX)`);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvboom",
    name: "TVBoom",
    description: "24 Hours",
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
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();

    // Step 1: Register (terms acceptance + captcha).
    await register(jar, username, email, password, taskId, emitter, log);

    // Step 2: Poll inbox for the confirmation email and extract the validation link.
    log(`[${TAG}] Waiting for confirmation email…`);
    const validationUrl = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        filterText: "tvboom",
        pattern: VALIDATION_LINK_RE,
        seenIds: inboxSeenIds,
        timeout: 90_000,
      },
    );
    if (!validationUrl)
      throw new Error(
        `[${TAG}] Validation link not found in TVBoom confirmation email.`,
      );

    // Step 3: Click the validation link to confirm the account.
    log(`[${TAG}] Confirming account…`);
    await get(validationUrl, jar);
    log(`[${TAG}] ✅ Account confirmed`);

    // Step 4: Activate the 24-hour trial from the cabinet.
    await activateTrial(jar, log);

    const tvPlaylist = `${BASE}/${username}/${password}/hls/playlist.m3u8`;
    log(`[${TAG}] ✅ Trial activated. Playlist: ${tvPlaylist}`);

    return buildResult({
      username,
      password,
      tvPlaylist,
      hours: TRIAL_HOURS,
      note: "24-hour IPTV trial activated successfully.",
    });
  },
};
