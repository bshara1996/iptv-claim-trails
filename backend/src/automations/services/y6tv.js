import { createRegistrationService } from "./rutv.js";

const base = createRegistrationService({
  id: "y6tv",
  name: "Y6TV",
  url: "https://rg.y6tv.me/regfm.php?devTypeID=100",
  filterText: "y6tv",
  description: "Y6TV IPTV free trial registration",
});

export default {
  ...base,

  async execute(ctx) {
    const result = await base.execute(ctx);

    const expiresAt = new Date(Date.now() + 3 * 864e5).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return { ...result, duration: "3 Days", expiresAt };
  },
};
