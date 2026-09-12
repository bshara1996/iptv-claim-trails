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
import MailTmProvider from "../email/mailtm.js";
import TmailyProvider from "../email/tmaily.js";
import DisposeLolProvider from "../email/disposelol.js";
import HioMailProvider from "../email/hiomail.js";

import Y6TvService from "../services/russian-services/y6tv.js";
import OgoTvService from "../services/russian-services/ogotv.js";
import VeleStoreService from "../services/russian-services/velestore.js";
import TvBoomService from "../services/russian-services/tvboom.js";

import TvCornService from "../services/world-services/tvcorn.js";
import OneIptv4kService from "../services/world-services/oneiptv4k.js";
import KookaService from "../services/kooka-kiwi-platform/kooka.js";
import MyKiwiTvService from "../services/kooka-kiwi-platform/mykiwitv.js";

import VocoIptvService from "../services/world-services/line-trxdnscloud/vocoiptv.js";
import FosTvService from "../services/world-services/line-trxdnscloud/fostv.js";
import LayerSevenTvService from "../services/world-services/line-trxdnscloud/layerseventv.js";
import LayerSevenStvService from "../services/world-services/line-trxdnscloud/layersevenstv.js";
import RevoIptvService from "../services/world-services/line-trxdnscloud/revoiptv.js";
import IPTVSubscribeService from "../services/world-services/line-trxdnscloud/iptvsubscribe.js";
import EmeraldIptvService from "../services/world-services/line-trxdnscloud/emeraldiptv.js";

import IptvSkyService from "../services/world-services/iptvsky.js";
import GreatestIptvService from "../services/world-services/greatestiptv.js";

import LibertyTvService from "../services/local-services/libertytv.js";
import LayerSevenService from "../services/local-services/layerseven.js";

import UspehService from "../services/russian-services/uspeh.js";
import RuTvService from "../services/russian-services/rutv.js";

export const emailProviders = [
  EmailnatorProvider,
  DropMailProvider,
  MailTmProvider,
  TmailyProvider,
  DisposeLolProvider,
  HioMailProvider,
];

export const registrationServices = [
  Y6TvService,
  OgoTvService,
  VeleStoreService,
  TvBoomService,

  TvCornService,
  OneIptv4kService,
  KookaService,
  MyKiwiTvService,

  // http://line.trxdnscloud.ru
  VocoIptvService,
  FosTvService,
  LayerSevenTvService,
  LayerSevenStvService,
  RevoIptvService,
  IPTVSubscribeService,
  EmeraldIptvService,

  IptvSkyService,
  GreatestIptvService,

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
