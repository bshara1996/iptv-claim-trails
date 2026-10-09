/**
 * EuroView TV — Promax (Premium Server).
 * Server: http://line.rapid-pro.cc
 * Expiry: 24 hours (from API response).
 */

import { executeEuroView } from "./base.js";

const TAG = "EuroView TV (Promax)";
const SERVER_ID = "promax";

export default {
  meta: {
    id: "euroviewtv-promax",
    name: TAG,
    description: "24 Hours",
    group: "best",
  },

  execute: (ctx) =>
    executeEuroView(ctx, { serverId: SERVER_ID, tag: TAG, trialHours: 24 }),
};
