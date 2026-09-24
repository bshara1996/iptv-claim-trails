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
import DisposeLolProvider from "../email/disposelol.js";
import FiveMinMailProvider from "../email/fiveMinMail.js";
import TempMailIngProvider from "../email/tempmailIng.js";
import BestMailProvider from "../email/bestTempMail.js";
import TempMailAppProvider from "../email/tempMailApp.js";
import TempMailFishProvider from "../email/tempMailFish.js";
import TmailPkProvider from "../email/tmailPk.js";
import TempMailCProvider from "../email/tempMailC.js";

import Y666Service from "../services/russian-services/y666.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";

import TvCornService from "../services/world-services/tvcorn.js";
import OneIptv4kService from "../services/world-services/oneiptv4k.js";
import KookaService from "../services/kooka-kiwi-platform/kooka.js";
import MyKiwiTvService from "../services/kooka-kiwi-platform/mykiwitv.js";

import RevoIptvService from "../services/world-services/revoiptv.js";
import EmeraldIptvService from "../services/world-services/emeraldiptv.js";

import IptvSkyService from "../services/world-services/iptvsky.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";
import StrevioService from "../services/world-services/strevio.js";

import LuxIptvService from "../services/local-services/luxiptv.js";
import LibertyTvService from "../services/local-services/libertytv.js";
import LayerSevenService from "../services/local-services/layerseven.js";

import UspehService from "../services/russian-services/uspeh.js";
import RuTvService from "../services/russian-services/rutv.js";

export const emailProviders = [
  EmailnatorProvider,
  DropMailProvider,
  DisposeLolProvider,
  FiveMinMailProvider,
  TempMailIngProvider,
  BestMailProvider,
  TempMailAppProvider,
  TempMailFishProvider,
  TmailPkProvider,
  TempMailCProvider,
];

export const registrationServices = [
  Y666Service,
  OgoTvService,
  VeleStoreService,
  TvBoomService,

  TvCornService,
  OneIptv4kService,
  KookaService,
  MyKiwiTvService,

  // http://line.trxdnscloud.ru
  RevoIptvService,
  EmeraldIptvService,

  IptvSkyService,
  GreatestIptvService,
  StrevioService,

  LuxIptvService,
  LibertyTvService,
  LayerSevenService,

  UspehService,
  RuTvService,
];

// Looks up a provider by its meta.id. Returns null if not found.
export function getProvider(id) {
  return emailProviders.find((p) => p.meta.id === id) ?? null;
}

// Looks up a service by its meta.id. Returns null if not found.
export function getService(id) {
  return registrationServices.find((s) => s.meta.id === id) ?? null;
}
