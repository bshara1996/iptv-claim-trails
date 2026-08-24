/**
 * Central registry of all email providers and registration services.
 *
 * To add a provider: create providers/<name>.js, import it, add it to emailProviders[].
 * To add a service:  create services/<name>.js,  import it, add it to registrationServices[].
 */

import TmailyProvider from "./providers/tmaily.js";
import DisposeLolProvider from "./providers/disposelol.js";
import MailTmProvider from "./providers/mailtm.js";

import Y6TvRegistration from "./services/y6tv.js";
import TvBoomRegistration from "./services/tvboom.js";
import VeleStoreRegistration from "./services/velestore.js";
import OneIptv4kRegistration from "./services/oneiptv4k.js";
import GreatestIptvRegistration from "./services/greatestiptv.js";
import LayerSevenRegistration from "./services/layerseven.js";
import TvCornRegistration from "./services/tvcorn.js";

export const emailProviders = [
  TmailyProvider,
  DisposeLolProvider,
  MailTmProvider,
];

export const registrationServices = [
  Y6TvRegistration,
  TvBoomRegistration,
  VeleStoreRegistration,
  OneIptv4kRegistration,
  GreatestIptvRegistration,
  LayerSevenRegistration,
  TvCornRegistration,
];

export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) || null;
}

export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) || null;
}
