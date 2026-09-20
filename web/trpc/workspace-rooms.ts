import { withSignal } from "../../server/operations/async";

import { workspaceProcedure } from "./workspace-procedure";
import {
  MatrixCreateInput,
  MatrixMessageInput,
  MatrixRoomInput,
  closeMatrixRoom,
  createMatrixRoom,
  listMatrixRooms,
  readMatrixMessages,
  sendMatrixMessage,
} from "../../server/matrix/rooms";

export const workspaceRoomsRouter = {
  list: workspaceProcedure.query(({ ctx, signal }) =>
    withSignal(signal, async () => listMatrixRooms(ctx.actor))
  ),
  create: workspaceProcedure
    .input(MatrixCreateInput)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => createMatrixRoom(ctx.actor, input))
    ),
  messages: workspaceProcedure
    .input(MatrixRoomInput)
    .query(({ ctx, input, signal }) =>
      withSignal(signal, async () => readMatrixMessages(ctx.actor, input.id))
    ),
  send: workspaceProcedure
    .input(MatrixMessageInput)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => sendMatrixMessage(ctx.actor, input))
    ),
  close: workspaceProcedure
    .input(MatrixRoomInput)
    .mutation(({ ctx, input, signal }) =>
      withSignal(signal, async () => closeMatrixRoom(ctx.actor, input.id))
    ),
};
