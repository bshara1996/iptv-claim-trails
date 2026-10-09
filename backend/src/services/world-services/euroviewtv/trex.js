/**
 * EuroView TV — Trex (Platinum Server 1).
 * Server: http://line.trxdnscloud.ru
 * Expiry: always 01:00 AM the following day (server-side behaviour).
 */

import { executeEuroView } from "./base.js";

const TAG = "EuroView TV (Trex)";
const SERVER_ID = "trex";

// Trex always expires at 01:00 AM the next day regardless of the API value.
const getExpiry = () => new Date(new Date().setHours(25, 0, 0, 0));

export default {
  meta: {
    id: "euroviewtv-trex",
    name: TAG,
    description: "Until 01:00 AM next day",
    group: "trex",
  },

  execute: (ctx) =>
    executeEuroView(ctx, { serverId: SERVER_ID, tag: TAG, getExpiry }),
};
