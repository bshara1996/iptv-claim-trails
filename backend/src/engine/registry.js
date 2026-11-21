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
import TempMailFishProvider from "../email/tempMailFish.js";
import TempMailHubOrgProvider from "../email/tempMailHubOrg.js";
import TempMailHubTechProvider from "../email/tempMailHubTech.js";
import TempGmailerProvider from "../email/tempgmailer.js";
import TrueTempMailProvider from "../email/truetempmail.js";

// ── Russian services ──────────────────────────────────────────────────────────

import Y666Service from "../services/russian-services/y666.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import StreamingElbusService from "../services/russian-services/streamingelbus.js";
import UspehService from "../services/russian-services/jwt-verify/uspeh.js";
import RuTvService from "../services/russian-services/jwt-verify/rutv.js";

// ── Golden services ──────────────────────────────────────────────────────────

import IiptvCanadaService from "../services/golden/iiptvcanada.js";
import SoxProviderService from "../services/golden/soxprovider.js";
import ZumIptvService from "../services/golden/zumiptv.js";
import IptvDigiService from "../services/golden/iptvdigi.js";
import Watch5TvService from "../services/golden/watch5tv.js";
import StrevioService from "../services/golden/strevio.js";

// ── Trex services ──────────────────────────────────────────────────────────────

import TrexIptvService from "../services/trex/trexiptv.js";
import IptvExpertenService from "../services/trex/iptvexperten.js";
import TvonnetService from "../services/trex/tvonnet.js";
import BalkanSbsService from "../services/trex/balkansbs.js";

// ── World 8K services ─────────────────────────────────────────────────────────

import TvCornService from "../services/world-8k/tvcorn.js";
import VoltixTvService from "../services/world-8k/voltixtv.js";

// ── World services ────────────────────────────────────────────────────────────

import GreatestIptvService from "../services/world-services/greatestiptv.js";
import PongoIptvService from "../services/world-services/pongoiptv.js";

// ── Not Working services ───────────────────────────────────────────────────────
import WebestIptvService from "../services/not-working/webestiptv.js";
import SalesCornerService from "../services/not-working/salescorner.js";
import IptvzService from "../services/not-working/iptvz.js";

import IptvTrexService from "../services/not-working/iptvtrex.js";
import DinoIptvService from "../services/not-working/dinoiptv.js";

import MapleStreamTvService from "../services/not-working/maplestreamtv.js";
import Maple4kService from "../services/not-working/maple4k.js";
import IptvMapleTvService from "../services/not-working/iptvmapletv.js";
import Mojo4kTvService from "../services/not-working/mojo4ktv.js";
import IptvMojoService from "../services/not-working/iptvmojo.js";
import Mojo4kDeService from "../services/not-working/mojo4kde.js";

// ── Exports ───────────────────────────────────────────────────────────────────

export const emailProviders = [
  EmailnatorProvider,
  TempGmailerProvider,
  TrueTempMailProvider,
  TempMailHubTechProvider,

  DropMailProvider,
  FiveMinMailProvider,
  TempMailIngProvider,
  BestMailProvider,
  TempMailFishProvider,
  TempMailHubOrgProvider,
];

export const registrationServices = [
  // Russian
  Y666Service,
  VeleStoreService,
  TvBoomService,
  OgoTvService,
  StreamingElbusService,
  UspehService,
  RuTvService,

  // Golden
  IiptvCanadaService,
  SoxProviderService,
  ZumIptvService,
  IptvDigiService,
  Watch5TvService,
  StrevioService,

  // Trex
  TrexIptvService,
  IptvExpertenService,
  TvonnetService,
  BalkanSbsService,

  // World 8K
  TvCornService,
  VoltixTvService,

  // World
  GreatestIptvService,
  PongoIptvService,

  // Not Working
  WebestIptvService,
  SalesCornerService,
  IptvzService,

  IptvTrexService,
  DinoIptvService,

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
