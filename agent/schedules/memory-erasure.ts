import { defineSchedule } from "eve/schedules";
import { drainMemoryErasures } from "../../server/memory/erasure";

export default defineSchedule({
  cron: "*/5 * * * *",
  run: async () => {
    await drainMemoryErasures();
  },
});
