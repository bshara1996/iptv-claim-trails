/**
 * Balkan SBS — free trial via API POST.
 * https://balkaniptv.de/
 * Flow:
 *   1. POST https://api-production-9e079.up.railway.app/api/trials/request — submit trial request.
 *   2. Poll inbox — extract M3U link from credentials email.
 */
import { simplePost } from "../../engine/simplePost.js";
import { generateUsername, generatePhone } from "../../parsing/generators.js";

// Generate a 32-character hex string for deviceId (no hyphens)
const generateDeviceId = () => {
  const chars = "0123456789abcdef";
  return Array.from(
    { length: 32 },
    () => chars[Math.floor(Math.random() * 16)],
  ).join("");
};

const TAG = "Balkan [Foreign] ";
const TRIAL_URL =
  "https://api-production-9e079.up.railway.app/api/trials/request";
const FILTER_TEXT = ["noreply@scalesystems.store", "Costumer Services"];
const TRIAL_HOURS = 24;

export default simplePost({
  meta: {
    id: "balkaniptv",
    name: TAG,
    description: `${TRIAL_HOURS} Hours [1]`,
    group: "trex",
  },
  url: TRIAL_URL,
  filterText: FILTER_TEXT,
  trialHours: TRIAL_HOURS,
  payload: (email) => ({
    email: email.trim(),
    firstName: generateUsername(),
    lastName: generateUsername(),
    phone: `+972${generatePhone()}`,
    lpId: "balkan-sbs", // try "trial-99"
    deviceId: generateDeviceId(),
  }),
});
