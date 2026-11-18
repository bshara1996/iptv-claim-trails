/**
 * DinoIPTV (dinoiptv.co) — free trial via WHMCS checkout.
 *
 * Flow:
 *   1. GET  /clients/index.php?rp=/store/free/free-trial-dino
 *           → WHMCS adds the free trial product to the cart and redirects to ?a=view.
 *   2. GET  /clients/cart.php?a=checkout
 *           → scrape the live per-session CSRF token.
 *   3. POST /clients/cart.php?a=checkout  (with live token + all form fields)
 *           → WHMCS creates the account and redirects to ?a=complete on success.
 *   4. Wait for the welcome/credentials email and extract the M3U link.
 */

import { buildResult } from "../../parsing/generators.js";
import { createJar, get } from "../../http/cookieClient.js";
import { fetch as undiciFetch } from "undici";

// ── Config ────────────────────────────────────────────────────────────────────

const TAG = "DinoIPTV";
const BASE = "https://dinoiptv.co/clients";
const PRODUCT_URL = `${BASE}/index.php?rp=/store/free/free-trial-dino`;
const CHECKOUT_URL = `${BASE}/cart.php?a=checkout`;
const FILTER_TEXT = ["dinoiptv", "dino"];
const TRIAL_HOURS = 48;

// WHMCS checkout can be slow (account creation + email dispatch happen synchronously).
const CHECKOUT_TIMEOUT_MS = 90_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Serialises the shared cookie jar to a Cookie header string.
const cookieStr = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

// Harvests Set-Cookie headers from a response into the shared jar.
const mergeCookies = (jar, res) => {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
};

// Extracts the CSRF token WHMCS embeds as a JS variable on every page.
const extractToken = (html) =>
  html.match(/csrfToken\s*=\s*'([a-f0-9]+)'/)?.[1] ?? null;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "dinoiptv",
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
    const jar = createJar();

    // ── Step 1: Add product to cart ───────────────────────────────────────────
    // Visiting the product slug automatically adds it to the cart in WHMCS.
    log(`[${TAG}] 🛒 Adding free trial to cart...`);
    const { status: s1, finalUrl: f1 } = await get(PRODUCT_URL, jar);
    log(`[${TAG}] Cart response: ${s1} → ${f1}`);

    // ── Step 2: Scrape live CSRF token from the checkout page ─────────────────
    log(`[${TAG}] 🔐 Loading checkout page for CSRF token...`);
    const { text: checkoutPage, status: s2 } = await get(CHECKOUT_URL, jar);
    const token = extractToken(checkoutPage);
    if (!token)
      throw new Error(
        `[${TAG}] Could not extract CSRF token from checkout page.`,
      );
    log(`[${TAG}] Token acquired.`);

    // ── Step 3: POST checkout ─────────────────────────────────────────────────
    // Use a raw undici fetch with a higher timeout — WHMCS creates the account
    // and fires the welcome email before it responds, so it can take 30–60 s.
    log(`[${TAG}] 📝 Submitting checkout form...`);

    const body = new URLSearchParams({
      token,
      submit: "true",
      custtype: "new",
      loginemail: "",
      loginpassword: "",
      firstname: "kbagxs16303",
      lastname: "kbagxs16303",
      email: email.trim(),
      "country-calling-code-phonenumber": "1",
      phonenumber: "123456789",
      companyname: "",
      address1: "N/A",
      address2: "",
      city: "N/A",
      state: "N/A",
      postcode: "00000",
      country: "US",
      language: "english",
      password: "kbagxs16303",
      password2: "kbagxs16303",
      applycredit: "1",
      paymentmethod: "mailin",
      ccinfo: "new",
      ccnumber: "",
      ccexpirydate: "",
      cccvv: "",
      ccdescription: "",
      notes: "",
      marketingoptin: "1",
    }).toString();

    const postRes = await undiciFetch(CHECKOUT_URL, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Cookie: cookieStr(jar),
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://dinoiptv.co",
        Referer: CHECKOUT_URL,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(CHECKOUT_TIMEOUT_MS),
    });

    mergeCookies(jar, postRes);
    const postText = await postRes.text();
    const location = postRes.headers.get("location") ?? "";

    log(
      `[${TAG}] 📡 Checkout response: ${postRes.status} | Location: ${location || "(none)"}`,
    );

    // Surface any validation error WHMCS puts in the page
    const errMatch = postText.match(
      /Please correct the following errors[^<]*<ul[^>]*>([\s\S]*?)<\/ul>/i,
    );
    if (errMatch) {
      const errors = errMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(`[${TAG}] Checkout rejected: ${errors}`);
    }

    // On success WHMCS issues a 302 → ?a=complete; some versions redirect within
    // the same response or return 200 on the complete page directly.
    const succeeded =
      location.includes("a=complete") ||
      postRes.status === 302 ||
      postText.includes("Order Confirmation") ||
      postText.includes("Your order has been") ||
      postText.includes("cart.php?a=complete");

    if (!succeeded) {
      log(
        `[${TAG}] ⚠️ Checkout did not reach the complete page — proceeding anyway.`,
        "warn",
      );
    } else {
      log(`[${TAG}] ✅ Order placed successfully.`);
    }

    // ── Step 4: Wait for credentials email ───────────────────────────────────
    log(`[${TAG}] 📬 Waiting for credentials email...`);
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: FILTER_TEXT,
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (playlists.allM3uLinks.length) {
      const m3u = playlists.tvPlaylist ?? playlists.allM3uLinks[0];
      log(`[${TAG}] ✅ 🎁 Trial activated.`);
      log(`[${TAG}] 📺 ${m3u}`);
    } else {
      log(`[${TAG}] ⚠️ No M3U links found in credentials email.`, "warn");
    }

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
