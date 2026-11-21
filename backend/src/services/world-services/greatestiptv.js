/**
 * Greatest / Strimo IPTV — free trial.
 * Site: https://www.strimoiptv.com/free-trial/
 */
import { simplePost } from "../../engine/simplePost.js";

export default simplePost({
  meta: {
    id: "greatestiptv",
    name: "GreatestIPTV",
    description: "36 Hours",
    group: "other",
  },
  url: "https://www.strimoiptv.com/api/orders", // greatestiptv
  referer: "https://www.strimoiptv.com/free-trial/?trial=true", // greatestiptv
  filterText: [
    "greatestiptv",
    "noreply@greatestiptv.com",
    "strimoiptv",
    "no-reply@strimoiptv.com",
  ],
  trialHours: 36,
  payload: (email) => ({
    planId: "trial",
    email: email.trim(),
    planType: "standard",
    hasAdultContent: false,
  }),
});
