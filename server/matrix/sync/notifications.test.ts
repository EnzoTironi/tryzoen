import { expect, it, vi } from "vitest";
import { inboxNotifications } from "./notifications";
vi.mock("@shared/environment", () => ({
  env: { ZOEN_MATRIX_NATIVE_NOTIFICATIONS: false },
}));
it("does not claim native zero counts before the homeserver rollout is qualified", () => {
  expect(
    inboxNotifications(null, [], { next_batch: "native", rooms: {} })
  ).toBeNull();
});
