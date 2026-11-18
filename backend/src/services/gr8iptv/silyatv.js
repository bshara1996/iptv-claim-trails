/**
 * SilyaTV — free trial via email.
 * Site: https://silyatv.com
 */
import { simplePost } from "../../engine/simplePost.js";

export default simplePost({
  meta: {
    id: "silyatv",
    name: "SilyaTV",
    description: "36 Hours",
    group: "gr8iptv",
  },
  url: "https://silyatv.com/api/trial",
  filterText: ["SilyaTV", "support@silyatv.com"],
  trialHours: 36,
  payload: (email) => ({ email: email.trim() }),
});
