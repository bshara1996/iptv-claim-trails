/**
 * engine/registry.js
 *
 * Central registry of all email providers and registration services.
 *
 * Exports:
 *   emailProviders        — ordered list of all email provider objects
 *   registrationServices  — ordered list of all registration service objects
 *   getProvider(id)       — looks up a provider by meta.id, returns null if not found
 *   getService(id)        — looks up a service by meta.id, returns null if not found
 *
 * To add a provider: create email/<name>.js, import it, append to emailProviders.
 * To add a service:  create services/<name>.js, import it, append to registrationServices.
 */

// ── Email providers ───────────────────────────────────────────────────────────

import EmailnatorProvider from "../email/emailnator.js";
import DropMailProvider from "../email/dropmail.js";
import FiveMinMailProvider from "../email/fiveMinMail.js";
import TempMailIngProvider from "../email/tempmailIng.js";
import BestMailProvider from "../email/bestTempMail.js";
import TempMailAppProvider from "../email/tempMailApp.js";
import TempMailFishProvider from "../email/tempMailFish.js";
import TempMailHubProvider from "../email/tempMailHub.js";
import TmailProvider from "../email/tmail.js";

// ── Russian services ──────────────────────────────────────────────────────────

import Y666Service from "../services/russian-services/y666.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";

// ── World services ────────────────────────────────────────────────────────────

import WebestIptvService from "../services/world-services/webestiptv.js";
import iiptvcanada from "../services/world-services/iiptvcanada.js";
import StrevioService from "../services/world-services/strevio.js";
import Watch5TvService from "../services/world-services/watch5tv.js";
import ZumIptvService from "../services/world-services/zumiptv.js";
import AmbKonnectService from "../services/world-services/ambkonnect.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";
import PongoIptvService from "../services/world-services/pongoiptv.js";
import SoxProviderService from "../services/world-services/soxprovider.js";

// ── World 8K services ─────────────────────────────────────────────────────────

import Strong8kIptvService from "../services/World 8K/strong8kiptv.js";
import TvCornService from "../services/World 8K/tvcorn.js";
import IptvLoadService from "../services/World 8K/iptvload.js";

// ── Trex services ─────────────────────────────────────────────────────────────

import TrexIptvService from "../services/trex/trexiptv.js";
import TvOnNetService from "../services/trex/tvonnet.js";
import IptvExpertenService from "../services/trex/iptvexperten.js";
import MapleStreamTvService from "../services/trex/maplestreamtv.js";
import Maple4kService from "../services/trex/maple4k.js";
import IptvMapleTvService from "../services/trex/iptvmapletv.js";
import Mojo4kTvService from "../services/trex/mojo4ktv.js";
import IptvMojoService from "../services/trex/iptvmojo.js";
import Mojo4kDeService from "../services/trex/mojo4kde.js";

// ── Exports ───────────────────────────────────────────────────────────────────

export const emailProviders = [
  EmailnatorProvider,
  DropMailProvider,
  FiveMinMailProvider,
  TempMailIngProvider,
  BestMailProvider,
  TempMailAppProvider,
  TempMailFishProvider,
  TempMailHubProvider,
  TmailProvider,
];

export const registrationServices = [
  // Russian
  Y666Service,
  VeleStoreService,
  TvBoomService,
  OgoTvService,
  // World
  iiptvcanada,
  WebestIptvService,
  SoxProviderService,
  StrevioService,
  Watch5TvService,
  ZumIptvService,
  AmbKonnectService,
  GreatestIptvService,
  PongoIptvService,
  // World 8K
  Strong8kIptvService,
  IptvLoadService,
  TvCornService,
  // Trex
  TrexIptvService,
  TvOnNetService,
  IptvExpertenService,
  MapleStreamTvService,
  Maple4kService,
  IptvMapleTvService,
  Mojo4kTvService,
  IptvMojoService,
  Mojo4kDeService,
];

// Looks up a provider by its meta.id. Returns null if not found.
export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) ?? null;
}

// Looks up a service by its meta.id. Returns null if not found.
export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) ?? null;
}
