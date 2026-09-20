import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  readNativeReceipt,
  recordNativeReceipt,
} from "../../server/messaging/native-receipts";
import { workspaceFixture } from "./workspace-fixture";

test("native receipts are scoped, reject divergent replays and cascade with their workspace", async () => {
  let workspaceId: string;
  const inputId = randomUUID();
  {
    await using fixture = await workspaceFixture();
    workspaceId = fixture.actor.workspaceId;
    const receipt = {
      workspaceId,
      inputId,
      sessionId: randomUUID(),
      digest: "a".repeat(64),
    };
    await recordNativeReceipt(receipt);
    await recordNativeReceipt(receipt);
    expect(await readNativeReceipt(workspaceId, inputId)).toEqual({
      sessionId: receipt.sessionId,
      digest: receipt.digest,
    });
    expect(
      await readNativeReceipt(fixture.guestPersonal.workspaceId, inputId)
    ).toBeUndefined();
    await expect(
      recordNativeReceipt({ ...receipt, digest: "b".repeat(64) })
    ).rejects.toThrow("Conflicting native delivery receipt");
    await expect(
      recordNativeReceipt({ ...receipt, sessionId: randomUUID() })
    ).rejects.toThrow("Conflicting native delivery receipt");
    await recordNativeReceipt({
      ...receipt,
      workspaceId: fixture.guestPersonal.workspaceId,
      sessionId: randomUUID(),
    });
    expect(await readNativeReceipt(workspaceId, inputId)).toEqual({
      sessionId: receipt.sessionId,
      digest: receipt.digest,
    });
  }
  expect(await readNativeReceipt(workspaceId, inputId)).toBeUndefined();
});
