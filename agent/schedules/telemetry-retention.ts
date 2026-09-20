import { defineSchedule } from "eve/schedules";
import { pruneTelemetry } from "../../server/observability/events";

export default defineSchedule({
  cron: "17 * * * *",
  run: () => pruneTelemetry(),
});
