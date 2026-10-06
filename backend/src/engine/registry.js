/**
 * engine/registry.js
 *
 * Central registry of all email providers and registration services.
 *
 * To add a provider: create email/<name>.js, import it, add to emailProviders[].
 * To add a service:  create services/<name>.js, import it, add to registrationServices[].
 */

import EmailnatorProvider from "../email/emailnator.js";
import DropMailProvider from "../email/dropmail.js";
import FiveMinMailProvider from "../email/fiveMinMail.js";
import TempMailIngProvider from "../email/tempmailIng.js";
import BestMailProvider from "../email/bestTempMail.js";
import TempMailAppProvider from "../email/tempMailApp.js";
import TempMailFishProvider from "../email/tempMailFish.js";

import Y666Service from "../services/russian-services/y666.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";

import IptvSkyService from "../services/world-services/iptvsky.js";
import AmbKonnectService from "../services/world-services/ambkonnect.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";

import TvCornService from "../services/world-services/tvcorn.js";
import OneIptv4kService from "../services/world-services/oneiptv4k.js";
import RevoIptvService from "../services/world-services/revoiptv.js";
import StrevioService from "../services/world-services/strevio.js";

import GeoIptvService from "../services/world-services/geoiptv.js";
import VibeFlixTvService from "../services/world-services/vibeflixtv.js";
import FourKBestIptvService from "../services/world-services/4kbestiptv.js";
import Maple4kService from "../services/world-services/maple/maple4k.js";
import MapleStreamTvService from "../services/world-services/maple/maplestreamtv.js";
import LuxIptvService from "../services/local-services/luxiptv.js";

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
  Y666Service,
  OgoTvService,
  VeleStoreService,
  TvBoomService,

  IptvSkyService,
  AmbKonnectService,
  GreatestIptvService,

  TvCornService,
  OneIptv4kService,
  RevoIptvService, // http://line.trxdnscloud.ru
  StrevioService,

  GeoIptvService,
  VibeFlixTvService,
  FourKBestIptvService,
  Maple4kService,
  MapleStreamTvService,
  LuxIptvService,
];

// Looks up a provider by its meta.id. Returns null if not found.
export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) ?? null;
}

// Looks up a service by its meta.id. Returns null if not found.
export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) ?? null;
}
