import { otel } from "eve/instrumentation/otel";

export default otel({
  functionId: "zoen",
  traceChannelRequests: true,
  tracePolicy: () => ({
    emit: true,
    recordInputs: false,
    recordOutputs: false,
  }),
});
