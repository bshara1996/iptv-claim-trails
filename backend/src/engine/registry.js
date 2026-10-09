/**
 * engine/registry.js
 *
 * Central registry of all email providers and registration services.
 *
 * To add a provider: create email/<name>.js, import it, add to emailProviders[].
 * To add a service:  create services/<name>.js, import it, add to registrationServices[].
 */

// ── Email Providers ───────────────────────────────────────────────────────────
import EmailnatorProvider from "../email/emailnator.js";
import DropMailProvider from "../email/dropmail.js";
import FiveMinMailProvider from "../email/fiveMinMail.js";
import TempMailIngProvider from "../email/tempmailIng.js";
import BestMailProvider from "../email/bestTempMail.js";
import TempMailAppProvider from "../email/tempMailApp.js";
import TempMailFishProvider from "../email/tempMailFish.js";

// ── Group: Russian ────────────────────────────────────────────────────────────
import Y666Service from "../services/russian-services/y666.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";

// ── Group: Best ────────────────────────────────────────────────────────────
import IptvSkyService from "../services/world-services/iptvsky.js";
import StrevioService from "../services/world-services/strevio.js";
import TvCornService from "../services/world-services/tvcorn.js";
import EuroViewTvPromaxService from "../services/world-services/euroviewtv/promax.js";

// ── Group: Trex ───────────────────────────────────────────────────────────────
import MapleStreamTvService from "../services/world-services/trex/maplestreamtv.js";
import Maple4kService from "../services/world-services/trex/maple4k.js";
import EuroViewTvTrexService from "../services/world-services/euroviewtv/trex.js";

// ── Group: Other ──────────────────────────────────────────────────────────────
import AmbKonnectService from "../services/world-services/ambkonnect.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";
import OneIptv4kService from "../services/world-services/oneiptv4k.js";
import FourKBestIptvService from "../services/world-services/4kbestiptv.js";
import TvOnNetService from "../services/world-services/tvonnet.js";
import Watch5TvService from "../services/world-services/watch5tv.js";

export const emailProviders = [
  EmailnatorProvider,
  DropMailProvider,
  FiveMinMailProvider,
  TempMailIngProvider,
  BestMailProvider,
  TempMailAppProvider,
  TempMailFishProvider,
];

export const registrationServices = [
  // ── Russian ─────────────────────────────────────────────────────────────────
  Y666Service,
  OgoTvService,
  VeleStoreService,
  TvBoomService,

  // ── Best ────────────────────────────────────────────────────────────────────
  IptvSkyService,
  StrevioService,
  TvCornService,
  EuroViewTvPromaxService,

  // ── Trex ────────────────────────────────────────────────────────────────────
  MapleStreamTvService,
  Maple4kService,
  EuroViewTvTrexService,

  // ── Other ───────────────────────────────────────────────────────────────────
  AmbKonnectService,
  GreatestIptvService,
  OneIptv4kService,
  FourKBestIptvService,
  TvOnNetService,
  Watch5TvService,
];

// Looks up a provider by its meta.id. Returns null if not found.
export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) ?? null;
}

// Looks up a service by its meta.id. Returns null if not found.
export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) ?? null;
}
