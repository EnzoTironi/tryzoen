import { mapAsync } from "../../server/operations/async";
import { defineSchedule, type ScheduleToFn } from "eve/schedules";
import telegram from "@agent/channels/telegram";
import kapso from "@agent/channels/kapso";
import { channelPrincipal } from "../../server/channels/principal";
import { Messaging } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { drainAuthPrompts, dispatchItem } from "../../server/channels/dispatch";

const dispatchChannels = async function (to: ScheduleToFn) {
  const transport = ChannelTransport;
  const messaging = Messaging;
  await dispatchItem("auth-prompts", drainAuthPrompts());
  for (const channel of ["telegram", "kapso"] as const) {
    const candidates = await transport.inboxCandidates(channel, 25);
    await mapAsync(
      candidates,
      (identity) =>
        dispatchItem(
          identity.id,
          (async function () {
            const claim = await messaging.claimInbox({
              identityId: identity.id,
              leaseSeconds: 150,
            });
            if (!claim) return;
            // The destination validates this lease and loads its stored payload.
            await Promise.try(async () => {
              try {
                return await to(channel === "telegram" ? telegram : kapso, {
                  identityId: identity.id,
                  id: claim.id,
                  leaseToken: claim.leaseToken,
                }).send("", { auth: channelPrincipal(identity) });
              } catch {
                throw new Error("Channel handoff could not be confirmed.");
              }
            }).catch(() => {
              console.error("Scheduled channel handoff failed", {
                inboxId: claim.id,
              });
            });
          })()
        ),
      4
    );
    const outbound = await transport.outboxCandidates(channel, 25);
    await mapAsync(
      outbound,
      (identity) =>
        dispatchItem(identity.id, transport.drainOutbox(identity.id)),
      4
    );
  }
};

export default defineSchedule({
  cron: "* * * * *",
  run({ to, waitUntil }) {
    waitUntil(dispatchChannels(to));
  },
});
