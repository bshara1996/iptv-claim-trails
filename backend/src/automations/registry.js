/**
 * registry.js
 *
 * Central registry of all email providers and registration services.
 *
 * To add a new email provider:
 *   1. Create src/automations/providers/<name>.js
 *   2. Import it here and add it to emailProviders[]
 *
 * To add a new registration service:
 *   1. Create src/automations/services/<name>.js
 *   2. Import it here and add it to registrationServices[]
 */

import TmailyProvider from "./providers/tmaily.js";

import RuTvRegistration from "./services/rutv.js";
import TvBoomRegistration from "./services/tvboom.js";
import Y6TvRegistration from "./services/y6tv.js";
import VeleStoreRegistration from "./services/velestore.js";

export const emailProviders = [TmailyProvider];

export const registrationServices = [
  RuTvRegistration,
  TvBoomRegistration,
  Y6TvRegistration,
  VeleStoreRegistration,
];

export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) || null;
}

export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) || null;
}
