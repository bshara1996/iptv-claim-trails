/**
 * iiptv-canada.ca — API-based free trial.
 *
 * Site: https://iiptv-canada.ca/iptv-free-trial/
 *
 * Flow:
 *   1. POST /api/portfolio/free-trials → submit name, email, phone, device
 *   2. Poll inbox → wait for credentials email, extract M3U links
 *
 * Trial duration: 24 hours.
 *
 * Notes:
 *   - Origin header must be the site domain (iiptv-canada.ca), not the API host.
 *   - ownerToken is derived from SHA-256(email) so retries are idempotent;
 *     a different token for the same email triggers a 409 "Trial details changed".
 */
import { createHash } from "node:crypto";
import { simplePost } from "../../engine/simplePost.js";
import { generateUsername, generatePhone } from "../../parsing/generators.js";

// Derives a stable ownerToken from the email using SHA-256.
// Same email → same token, so retries are idempotent and the API won't reject them.
const ownerToken = (email) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

export default simplePost({
  meta: {
    id: "iiptvcanada",
    name: "iIPTV Canada",
    description: "24 Hours",
    group: "best",
  },
  url: "https://deepskyblue-dotterel-951962.hostingersite.com/api/portfolio/free-trials",
  referer: "https://iiptv-canada.ca/iptv-free-trial/",
  origin: "https://iiptv-canada.ca",
  filterText: ["iiptv-canada", "tarikamg44@gmail.com"],
  trialHours: 24,
  payload: (email) => ({
    name: generateUsername(),
    email: email.trim(),
    phone: generatePhone(),
    device: "pc",
    locale: "en",
    reminderConsent: true,
    website: "",
    ownerToken: ownerToken(email),
  }),
});
