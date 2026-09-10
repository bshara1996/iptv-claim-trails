/**
 * kooka-kiwi-platform/kooka.js
 *
 * Kooka.TV — free 12-hour trial (Kooka-Kiwi platform).
 */
import { generatePhone, generateUsername } from "../../parsing/generators.js";
import { createKookaKiwiService } from "./base.js";

export default createKookaKiwiService({
  id: "kooka",
  name: "Kooka.TV",
  description: "12 Hours",
  baseUrl: "https://kooka.tv",
  tag: "Kooka",
  // Always generates a fresh Kooka-specific email to avoid conflicts when running alongside MyKiwiTV
  buildPayload: (_email) => ({
    email: `${generateUsername()}@gmail.com`,
    whatsappNumber: generatePhone(),
    fpComponents: [],
  }),
});
