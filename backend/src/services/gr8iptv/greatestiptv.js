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
    group: "gr8iptv",
  },
  url: "https://www.strimoiptv.com/api/orders", // https://www.strimoiptv.com
  referer: "https://www.strimoiptv.com/free-trial/?trial=true", // https://www.strimoiptv.com
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
