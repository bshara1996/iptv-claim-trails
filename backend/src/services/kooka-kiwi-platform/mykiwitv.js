/**
 * kooka-kiwi-platform/mykiwitv.js
 *
 * MyKiwiTV — free 12-hour trial (Kooka-Kiwi platform).
 */
import { generatePhone, generateUsername } from "../../parsing/generators.js";
import { createKookaKiwiService } from "./base.js";

export default createKookaKiwiService({
  id: "mykiwitv",
  name: "MyKiwiTV",
  description: "12 Hours",
  baseUrl: "https://mykiwitv.com",
  tag: "MyKiwiTV",
  // Always generates a fresh MyKiwiTV-specific email to avoid conflicts when running alongside Kooka
  buildPayload: (_email) => ({
    email: `${generateUsername()}@gmail.com`,
    whatsappNumber: generatePhone(),
    fpComponents: [],
  }),
});
