/**
 * OneIPTV4K free trial registration service (API-based).
 *
 * Flow:
 *   1. GET /free-trial to retrieve CSRF token and session cookies.
 *   2. POST /free-trial with user info (name, email, WhatsApp, device type).
 *   3. Poll inbox for the 6-digit verification code.
 *   4. POST /free-trial/verify with CSRF token and OTP code.
 *   5. Poll inbox for the playlist email and return the M3U links.
 */
import {
  generateUsername,
  generatePhone,
  computeTrialExpiry,
} from "../utils/generators.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://oneiptv4k.com";
const TRIAL_URL = `${BASE_URL}/free-trial`;
const VERIFY_URL = `${BASE_URL}/free-trial/verify`;
const TAG = "OneIPTV4K";
const TRIAL_HOURS = 24;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

function updateCookies(cookies = "", res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") || ""];
  const map = new Map(
    cookies ? cookies.split("; ").map((c) => c.split("=")) : [],
  );
  for (const item of raw) {
    if (!item) continue;
    const [k, ...v] = item.split(";")[0].split("=");
    if (k.trim()) map.set(k.trim(), v.join("=").trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const extractCsrf = (html) =>
  html.match(/name="(?:_token|csrf-token)"[^>]*value="([^"]+)"/i)?.[1] ||
  html.match(/<input[^>]+name="_token"[^>]+value="([^"]+)"/i)?.[1] ||
  html.match(/content="([^"]+)"\s+name="csrf-token"/i)?.[1] ||
  html.match(/name="csrf-token"\s+content="([^"]+)"/i)?.[1];

const extractError = (html) => {
  const match = html.match(
    /<div[^>]*class="[^"]*(?:error-banner|alert-danger)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : null;
};

async function apiPost(url, data, cookies, referer = TRIAL_URL) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
      Referer: referer,
      Origin: BASE_URL,
    },
    body: new URLSearchParams(data),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  return { res, cookies: updateCookies(cookies, res) };
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "oneiptv4k",
    name: "OneIPTV4K (No Ml.tm)",
    url: TRIAL_URL,
    description: "24 Hours",
  },

  async execute({
    page,
    emailPage,
    provider,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    if (page?.close) await page.close().catch(() => {});

    const name = generateUsername();
    const whatsapp = generatePhone();

    // Step 1: GET registration page to extract initial CSRF token & session
    log(`[${TAG}] Requesting trial registration page via API...`);
    const getRes = await fetch(TRIAL_URL, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!getRes.ok)
      throw new Error(
        `HTTP ${getRes.status}: Failed to load registration page`,
      );

    let cookies = updateCookies("", getRes);
    const token = extractCsrf(await getRes.text());
    if (!token) throw new Error("Could not extract CSRF token.");

    // Step 2: Submit registration form
    log(`[${TAG}] Submitting registration for ${email}...`);
    const regResult = await apiPost(
      TRIAL_URL,
      {
        _token: token,
        name,
        email,
        whatsapp,
        device_type: "Smart TV (Samsung/LG)",
        message: "",
      },
      cookies,
    );
    cookies = regResult.cookies;

    if (regResult.res.status !== 302 && regResult.res.status !== 301) {
      const err = extractError(await regResult.res.text());
      if (err) throw new Error(`Registration error: ${err}`);
    }

    log(
      `[${TAG}] Registration accepted. Polling inbox for verification code...`,
    );

    // Step 3: Poll inbox for verification code
    await emailPage?.bringToFront?.().catch(() => {});
    const seenIds = new Set(inboxSeenIds);
    const code = await provider.waitForVerificationCodeEmail(emailPage, {
      filterText: "",
      codeRe:
        /(?:code|verification|confirm(?:ation)?|otp)[^0-9]{0,60}(\d{6})(?!\d)/i,
      seenIds,
      timeout: 120_000,
    });
    if (!code) throw new Error(`[${TAG}] Verification code not received.`);

    // Step 4: Submit verification code
    log(`[${TAG}] Submitting verification code (${code}) via API...`);
    const verifyGet = await fetch(VERIFY_URL, {
      headers: { "User-Agent": UA, Cookie: cookies, Referer: TRIAL_URL },
      signal: AbortSignal.timeout(15_000),
    });
    cookies = updateCookies(cookies, verifyGet);
    const verifyToken = extractCsrf(await verifyGet.text()) || token;

    const verifyResult = await apiPost(
      VERIFY_URL,
      { _token: verifyToken, code: String(code).trim() },
      cookies,
      VERIFY_URL,
    );
    cookies = verifyResult.cookies;

    const loc = verifyResult.res.headers.get("location") || "";
    if (loc.includes("/verify")) {
      const followRes = await fetch(loc, {
        headers: { "User-Agent": UA, Cookie: cookies, Referer: VERIFY_URL },
        signal: AbortSignal.timeout(15_000),
      });
      const err = extractError(await followRes.text());
      if (err) throw new Error(`Verification failed: ${err}`);
    }
    log(`[${TAG}] ✅ Email verified successfully.`);

    // Step 5: Poll inbox for playlist email
    await emailPage?.bringToFront?.().catch(() => {});
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      emailPage,
      { seenIds, timeout: 120_000 },
    );

    log(
      `[${TAG}] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}`,
    );

    return {
      username: name,
      password: null,
      tvPlaylist: playlists.tvPlaylist ?? null,
      vodPlaylist: playlists.vodPlaylist ?? null,
      allM3uLinks: playlists.allM3uLinks ?? [],
      duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
      expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
      status: "success",
      note: playlists.tvPlaylist
        ? "24-hour IPTV trial activated successfully."
        : "Registered — M3U links not found in confirmation email.",
    };
  },
};

/////////////////////////////////////////////////////////////////////////////////////

// /**
//  * OneIPTV4K free trial registration service.
//  *
//  * Flow:
//  *   1. Open the registration page and fill the form (name, email, WhatsApp).
//  *   2. Submit and wait for the verification code email.
//  *   3. Enter the code on the site to confirm.
//  *   4. Poll the inbox for the playlist email and return the result.
//  */
// import {
//   generateUsername,
//   generatePhone,
//   computeTrialExpiry,
// } from "../utils/generators.js";
// import { fillInstant, clickFirst } from "../utils/pageUtils.js";

// // ── Config ────────────────────────────────────────────────────────────────────

// const TRIAL_URL = "https://oneiptv4k.com/free-trial";
// const TAG = "OneIPTV4K";
// const TRIAL_HOURS = 24;
// const GOTO_OPTS = { waitUntil: "domcontentloaded", timeout: 20_000 };

// // ── Selectors ─────────────────────────────────────────────────────────────────

// const SELECTORS = {
//   name: 'input[name="name"]',
//   email: 'input[name="email"]',
//   whatsapp: 'input[name="whatsapp"]',
//   submit: 'button[type="submit"]',
//   codeInput: 'input[name="code"]',
// };

// // ── Service ───────────────────────────────────────────────────────────────────

// export default {
//   meta: {
//     id: "oneiptv4k",
//     name: "OneIPTV4K (Not Ml.tm)",
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
//     const name = generateUsername();
//     const whatsapp = generatePhone();

//     // Step 1: Fill and submit the registration form
//     await page.goto(TRIAL_URL, GOTO_OPTS).catch(() => {});
//     await fillInstant(page, {
//       [SELECTORS.name]: name,
//       [SELECTORS.email]: email,
//       [SELECTORS.whatsapp]: whatsapp,
//     });
//     await page.waitForTimeout(400);
//     await clickFirst(page, SELECTORS.submit);
//     await page.waitForLoadState("domcontentloaded").catch(() => {});
//     await page.waitForTimeout(1_000);

//     // Step 2: Poll inbox for the verification code.
//     // Subject/sender varies ("Digi Market", "IPTV Pro") so no filterText —
//     // codeRe anchors on a label word to avoid false matches from other emails.
//     await emailPage.bringToFront().catch(() => {});
//     const seenIds = new Set(inboxSeenIds);
//     const code = await provider.waitForVerificationCodeEmail(emailPage, {
//       filterText: "",
//       codeRe:
//         /(?:code|verification|confirm(?:ation)?|otp)[^0-9]{0,60}(\d{6})(?!\d)/i,
//       seenIds,
//       timeout: 120_000,
//     });
//     if (!code) throw new Error(`[${TAG}] Verification code not received.`);

//     // Step 3: Enter the verification code
//     await page.bringToFront().catch(() => {});
//     await page.waitForTimeout(600);
//     await fillInstant(page, { [SELECTORS.codeInput]: code });
//     await page.waitForTimeout(300);
//     await clickFirst(page, SELECTORS.submit);
//     await page.waitForLoadState("domcontentloaded").catch(() => {});
//     await page.waitForTimeout(1_000);

//     // Step 4: Poll inbox for the playlist email
//     await emailPage.bringToFront().catch(() => {});
//     const playlists = await provider.waitForEmailAndExtractPlaylists(
//       emailPage,
//       { seenIds, timeout: 120_000 },
//     );

//     log(
//       `[${TAG}] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}, total links: ${playlists.allM3uLinks.length}`,
//     );

//     return {
//       username: name,
//       password: null,
//       tvPlaylist: playlists.tvPlaylist ?? null,
//       vodPlaylist: playlists.vodPlaylist ?? null,
//       allM3uLinks: playlists.allM3uLinks ?? [],
//       duration: playlists.duration ?? `${TRIAL_HOURS} Hours`,
//       expiresAt: playlists.expiresAt ?? computeTrialExpiry(TRIAL_HOURS),
//       status: "success",
//       note: playlists.tvPlaylist
//         ? "24-hour IPTV trial activated successfully."
//         : "Registered — M3U links not found in confirmation email.",
//     };
//   },
// };
