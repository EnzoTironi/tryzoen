import { defineEvlogHook } from "evlog/eve";
import { defineHook } from "eve/hooks";

const telemetry = defineEvlogHook({
  init: {
    env: { service: "zoen" },
    redact: true,
  },
  message: "omit",
  redact: true,
  sessionEvent: true,
});

// Task receipts remain action results. Subagent lifecycle events are emitted
// outside Eve's session callback context and cannot support authored hooks.
const events = { ...telemetry.events };
delete events["subagent.called"];
delete events["subagent.started"];
delete events["subagent.completed"];

export default defineHook({ events });
