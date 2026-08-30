/**
 * TVCorn free trial registration service (API-based).
 *
 * Flow:
 *  1. GET /trial            — acquire session cookies + CSRF token
 *  2. POST /trial/sendOtp   — submit name/email, trigger OTP email
 *  3. Poll inbox            — extract 6-digit verification code
 *  4. POST /trial/verifyOtp — verify OTP, starts async account generation
 *  5. GET /trial/status     — poll every 3s until status === "completed"
 */
import { generateUsername, computeTrialExpiry } from "../utils/generators.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://en.tvcorn.com";
const TAG = "TVCorn";
const TRIAL_HOURS = 24;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 180_000;

// All country codes the UI selects by default
const ALL_COUNTRIES = [
  "de",
  "at",
  "ch",
  "tr",
  "al",
  "xk",
  "mk",
  "rs",
  "hr",
  "ba",
  "me",
  "si",
  "bg",
  "ro",
  "gr",
  "it",
  "es",
  "fr",
  "gb",
  "us",
  "ca",
  "mx",
  "nl",
  "be",
  "pt",
  "pl",
  "cz",
  "sk",
  "hu",
  "se",
  "no",
  "dk",
  "fi",
  "ru",
  "ua",
  "ar",
  "in",
  "pk",
  "kr",
  "cn",
  "jp",
  "th",
  "ph",
  "id",
  "br",
  "ar2",
  "co",
  "cl",
  "pe",
  "eg",
  "ng",
  "za",
  "ke",
  "ae",
  "iq",
  "ir",
  "az",
  "ge",
  "world",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract CSRF token injected into the trial page script block. */
const extractCsrf = (html) => html.match(/csrfToken:\s*'([^']+)'/)?.[1] ?? null;

/** Maintain a mutable session cookie jar. */
class CookieJar {
  _jar = new Map();

  update(headers) {
    for (const raw of headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0)
        this._jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  toString() {
    return [...this._jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/** Fetch with session cookie forwarding and a 30s hard timeout. */
const apiFetch = (path, { jar, ...opts } = {}) =>
  fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/html",
      ...(jar && { Cookie: jar.toString() }),
      ...opts.headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvcorn",
    name: "TVCorn (No Ml.tm)",
    url: `${BASE_URL}/trial`,
    description: "24 Hours",
  },

  async execute({
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();
    const jar = new CookieJar();
    const postForm = (data) => new URLSearchParams(data);

    // Step 1: Session & CSRF token
    const initRes = await apiFetch("/trial");
    jar.update(initRes.headers);
    const csrf = extractCsrf(await initRes.text());
    if (!csrf) throw new Error("Could not extract CSRF token.");

    // Step 2: Send OTP email
    const otpBody = postForm({ _token: csrf, name: username, email });
    ALL_COUNTRIES.forEach((c) => otpBody.append("countries[]", c));

    const postOpts = {
      method: "POST",
      jar,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };
    const otpRes = await apiFetch("/trial/sendOtp", {
      ...postOpts,
      body: otpBody,
    });
    jar.update(otpRes.headers);
    const otpJson = await otpRes.json();

    if (otpJson.status !== "true" && otpJson.status !== true)
      throw new Error(`sendOtp failed: ${otpJson.message ?? "Unknown error"}`);
    log(`[${TAG}] ✅ OTP sent to ${email}`);

    // Step 3: Wait for OTP in inbox
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "tvcorn",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });
    if (!code) throw new Error("Verification code not received.");
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // Step 4: Verify OTP — triggers async account generation
    const verifyRes = await apiFetch("/trial/verifyOtp", {
      ...postOpts,
      body: postForm({ _token: csrf, email, otp: code }),
    });
    jar.update(verifyRes.headers);
    const verifyJson = await verifyRes.json();

    if (verifyJson.status === "false" || verifyJson.status === "error")
      throw new Error(
        `OTP verification failed: ${verifyJson.message ?? "Invalid code"}`,
      );
    log(`[${TAG}] ✅ Email verified — waiting for account generation…`);

    // Step 5: Poll /trial/status until completed or timeout
    let data = null;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await apiFetch("/trial/status", { jar });
      jar.update(statusRes.headers);
      const statusJson = await statusRes.json().catch(() => null);

      log(`[${TAG}] poll → ${JSON.stringify(statusJson)}`);

      if (statusJson?.status === "completed" && statusJson.data) {
        data = statusJson.data;
        break;
      }
      if (statusJson?.status === "failed")
        throw new Error(
          statusJson.data?.message ?? "Account generation failed.",
        );
    }

    if (!data) throw new Error("Account generation timed out.");
    log(`[${TAG}] ✅ Account ready — raw data: ${JSON.stringify(data)}`);

    const m3uLink = data.m3u ?? data.m3u_url ?? data.playlist ?? null;

    return {
      username: data.username,
      password: data.password,
      tvPlaylist: m3uLink,
      vodPlaylist: null,
      allM3uLinks: m3uLink ? [m3uLink] : [],
      duration: `${TRIAL_HOURS} Hours`,
      expiresAt: computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: m3uLink
        ? "TVCorn trial activated successfully."
        : "Trial registered — M3U link not found.",
    };
  },
};

////////////////////////////////////////////////////////////////////
// /**
//  * TVCorn free trial registration service.
//  *
//  * Fills the registration form, verifies the OTP from the inbox email,
//  * then extracts the M3U playlist link from the credentials page.
//  */
// import { generateUsername, computeTrialExpiry } from "../utils/generators.js";
// import { fillInstant, clickFirst, extractM3u } from "../utils/pageUtils.js";

// // ── Config ────────────────────────────────────────────────────────────────────

// const TRIAL_URL = "https://en.tvcorn.com/trial";
// const TAG = "TVCorn";
// const TRIAL_HOURS = 24;
// const GOTO_OPTS = { waitUntil: "commit", timeout: 20_000 };

// // ── Selectors ─────────────────────────────────────────────────────────────────

// const SELECTORS = {
//   name: 'input[name="name"]',
//   email: 'input[name="email"]',
//   continueBtn: '.js-go-to-step[target-step="3"]',
//   otpBox: ".otp-box",
//   confirmSubmit: ".js-verify-otp",
//   knowWhatImDoing: '.js-go-to-step[target-step="6"]',
//   m3uTab: '.js-tab-btn[data-tab="m3u"]',
//   m3uValue: ".js-val-m3u",
// };

// // ── Service ───────────────────────────────────────────────────────────────────

// export default {
//   meta: {
//     id: "tvcorn",
//     name: "TVCorn (Not Ml.tm)",
//     url: TRIAL_URL,
//     description: "24 Hours",
//   },

//   async execute({
//     page,
//     emailPage,
//     provider,
//     email,
//     inboxSeenIds = new Set(),
//     log = () => {},
//   }) {
//     const username = generateUsername();

//     // Step 1: Fill and submit the registration form
//     await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
//     await page
//       .waitForSelector(SELECTORS.name, { state: "visible", timeout: 10_000 })
//       .catch(() => {});
//     await fillInstant(page, {
//       [SELECTORS.name]: username,
//       [SELECTORS.email]: email,
//     });
//     await clickFirst(page, SELECTORS.continueBtn);

//     // Step 2: Poll inbox for the OTP verification code
//     await emailPage.bringToFront().catch(() => {});
//     const code = await provider.waitForVerificationCodeEmail(emailPage, {
//       filterText: "tvcorn",
//       seenIds: new Set(inboxSeenIds),
//       timeout: 120_000,
//     });

//     if (!code) throw new Error("Verification code not received.");
//     log(`[${TAG}] ✅ Verification code received: ${code}`);

//     // Step 3: Enter OTP and confirm
//     await page.bringToFront().catch(() => {});
//     await fillInstant(page, { [SELECTORS.otpBox]: code });
//     await clickFirst(page, SELECTORS.confirmSubmit);

//     // Step 4: Dismiss the "I know what I'm doing" prompt and open the M3U tab
//     await page
//       .waitForSelector(SELECTORS.knowWhatImDoing, {
//         state: "visible",
//         timeout: 15_000,
//       })
//       .catch(() => {});
//     await clickFirst(page, SELECTORS.knowWhatImDoing);

//     await page
//       .waitForSelector(SELECTORS.m3uTab, { state: "visible", timeout: 8_000 })
//       .catch(() => {});
//     await clickFirst(page, SELECTORS.m3uTab);

//     // Step 5: Extract the M3U link
//     const m3uLink = await extractM3u(page);

//     if (m3uLink) log(`[${TAG}] ✅ M3U extracted: ${m3uLink}`);
//     else log(`[${TAG}] M3U link not found on credentials page.`, "warn");

//     return {
//       username,
//       password: null,
//       tvPlaylist: m3uLink ?? null,
//       vodPlaylist: null,
//       allM3uLinks: m3uLink ? [m3uLink] : [],
//       duration: `${TRIAL_HOURS} Hours`,
//       expiresAt: computeTrialExpiry(TRIAL_HOURS),
//       status: "success",
//       note: m3uLink
//         ? "TVCorn trial activated successfully."
//         : "Trial registered — M3U link not found on credentials page.",
//     };
//   },
// };
