/**
 * Fos TV (fostv.io) — free 24-hour trial (voco-fos-layer-iptvs platform).
 */
import { createSubmitTrialService } from "../../rest-submit-trial-handler.js";

export default createSubmitTrialService({
  id: "fostv",
  name: "Fos TV",
  domain: "fostv.io",
  websiteId: "d9ea854b-d576-41b4-9ea5-e3be27af5b41",
  filterText: "fostv",
});
