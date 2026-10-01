import { searchWorkspaceBots } from "./bots";
import { PublishedSkillPath } from "./skill-document";
import type { z } from "zod";
import {
  referenceResultsSchema,
  type referenceSearchSchema,
} from "@zoen/companion-ui/references";
import { WorkspaceRepository } from "./repository";
import { requireWorkspaceAccess, type WorkspaceActorSchema } from "./access";
import { requireJoinedMatrixRoom } from "../matrix/rooms";
import { readRoomMembers } from "../matrix/members";
import { lockMatrixAdmission } from "../matrix/authority";
import { transaction } from "@db/queries";
import { searchDirectory } from "../accounts/directory";
import { listReminders } from "../schedules/queries";

/** References contain identifiers only. Choosing one never executes a tool or reads a file. */
export async function searchComposerReferences(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof referenceSearchSchema>
) {
  return transaction(async () => {
    await lockMatrixAdmission(
      [actor.workspaceId],
      input.roomId ? [input.roomId] : []
    );
    await requireWorkspaceAccess(actor);
    const room = input.roomId
      ? await requireJoinedMatrixRoom(actor, input.roomId)
      : undefined;
    const scoped =
      room?.kind === "group"
        ? {
            userId: actor.userId,
            workspaceId: actor.workspaceId,
            groupBindingId: room.id,
            groupEpoch: room.epoch,
            matrixIdentityId: room.matrixId,
          }
        : actor;
    const needle = input.query.toLocaleLowerCase();
    if (input.trigger === "/") {
      const page = await listReminders(scoped);
      return referenceResultsSchema.parse(
        page.reminders
          .filter((item) => item.prompt.toLocaleLowerCase().includes(needle))
          .slice(0, 24)
          .map((item) => ({
            id: item.id,
            kind: "routine",
            title: item.prompt.slice(0, 100),
            detail: item.status,
            token: `/routine:${item.id}`,
          }))
      );
    }
    const listing = await WorkspaceRepository.read(scoped);
    const files = listing.files
      .filter(
        (path) =>
          path.toLocaleLowerCase().includes(needle) &&
          (input.trigger === "$"
            ? PublishedSkillPath.safeParse(path).success
            : !path.startsWith("skills/"))
      )
      .slice(0, 24)
      .map((path) => ({
        id: path,
        kind:
          input.trigger === "$"
            ? "skill"
            : path.startsWith("artifacts/")
              ? "artifact"
              : "file",
        title: path.split("/").at(-1) ?? path,
        detail: path,
        token: `${input.trigger}${/\s/u.test(path) ? JSON.stringify(path) : path}`,
      }));
    if (input.trigger === "$") return referenceResultsSchema.parse(files);
    const people = room
      ? await readRoomMembers(actor, room.id, room.kind)
      : (await searchDirectory(actor, input.query.slice(0, 30))).map(
          (person) => ({
            username: person.username,
            name: person.username,
            bot: false,
          })
        );
    const bots =
      !input.roomId && /^(?:[a-z][a-z0-9_]{1,29})?$/u.test(needle)
        ? await searchWorkspaceBots(actor, needle)
        : [];
    return referenceResultsSchema.parse(
      [
        ...bots.slice(0, 6).map((bot) => ({
          id: bot.username,
          kind: "bot",
          title: bot.name,
          detail: `@${bot.username}`,
          token: `@${bot.username}`,
        })),
        ...people
          .filter(
            (person) =>
              person.username &&
              `${person.name} ${person.username}`
                .toLocaleLowerCase()
                .includes(needle)
          )
          .slice(0, 12)
          .map((person) => ({
            id: person.username,
            kind: person.bot ? "bot" : "person",
            title: person.name,
            detail: `@${person.username ?? ""}`,
            token: `@${person.username ?? ""}`,
          })),
        ...files,
      ].slice(0, 24)
    );
  });
}
