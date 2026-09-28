import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RoomData } from "./schema";

export function useDirectConversation(
  data: RoomData,
  cacheScope: string,
  onOpened: (id: string) => void
) {
  const operation = useRef({ username: "", operationId: "" });
  const client = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => {
      if (operation.current.username !== username)
        operation.current = { username, operationId: data.operationId() };
      return data.openDirect(operation.current);
    },
    onSuccess: async (room) => {
      await client.invalidateQueries({
        queryKey: ["matrix-directs", cacheScope],
      });
      onOpened(room.id);
    },
  });
}
