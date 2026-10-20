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
import iiptvcanada from "../services/world-services/iiptvcanada.js";
import StrevioService from "../services/world-services/strevio.js";
import Watch5TvService from "../services/world-services/watch5tv.js";
import Strong8kIptvService from "../services/world-services/strong8kiptv.js";
import TvCornService from "../services/world-services/tvcorn.js";
import EuroViewTvPromaxService from "../services/world-services/euroviewtv/promax.js";

// ── Group: Trex ───────────────────────────────────────────────────────────────
import TrexIptvService from "../services/world-services/trex/trexiptv.js";
import TvOnNetService from "../services/world-services/trex/tvonnet.js";
import IptvExpertenService from "../services/world-services/trex/iptvexperten.js";
import SacoTvService from "../services/world-services/trex/sacotv.js";
import MapleStreamTvService from "../services/world-services/trex/maplestreamtv.js";
import Maple4kService from "../services/world-services/trex/maple4k.js";
import IptvMapleTvService from "../services/world-services/trex/iptvmapletv.js";
import Mojo4kTvService from "../services/world-services/trex/mojo4ktv.js";
import IptvMojoService from "../services/world-services/trex/iptvmojo.js";
import Mojo4kDeService from "../services/world-services/trex/mojo4kde.js";
import EuroViewTvTrexService from "../services/world-services/euroviewtv/trex.js";

// ── Group: Other ──────────────────────────────────────────────────────────────
import AmbKonnectService from "../services/world-services/ambkonnect.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";
import OneIptv4kService from "../services/world-services/oneiptv4k.js";
import PongoIptvService from "../services/world-services/pongoiptv.js";
import NxtIptvService from "../services/world-services/nxtiptv.js";
import SoxProviderService from "../services/world-services/soxprovider.js";

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
  iiptvcanada,
  StrevioService,
  Watch5TvService,
  Strong8kIptvService,
  TvCornService,
  EuroViewTvPromaxService,

  // ── Trex ────────────────────────────────────────────────────────────────────
  TrexIptvService,
  TvOnNetService,
  IptvExpertenService,
  SacoTvService,
  MapleStreamTvService,
  Maple4kService,
  IptvMapleTvService,
  Mojo4kTvService,
  IptvMojoService,
  Mojo4kDeService,
  EuroViewTvTrexService,

  // ── Other ───────────────────────────────────────────────────────────────────
  AmbKonnectService,
  GreatestIptvService,
  OneIptv4kService,
  PongoIptvService,
  NxtIptvService,
  SoxProviderService,
];

// Looks up a provider by its meta.id. Returns null if not found.
export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) ?? null;
}

// Looks up a service by its meta.id. Returns null if not found.
export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) ?? null;
}
