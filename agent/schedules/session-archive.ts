import { defineSchedule } from "eve/schedules";
import { drainSessionSources } from "../../server/memory/session-capture";

export default defineSchedule({
  cron: "* * * * *",
  async run() {
    await drainSessionSources();
  },
});
