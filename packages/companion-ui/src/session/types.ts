import type {
  CancelSessionResult,
  InputResponse,
  MessageStreamEvent,
  RespondTurnOptions,
  SendTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import type { UserContent } from "ai";
import type { OutgoingMessage } from "../conversation/outbox";

export interface ChatAgent {
  readonly cancel: () => Promise<CancelSessionResult>;
  readonly data: EveMessageData;
  readonly delivery?: ReadonlyMap<
    string,
    Pick<OutgoingMessage<unknown, unknown>, "status" | "queued">
  >;
  readonly error?: Error;
  readonly events: readonly MessageStreamEvent[];
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly olderError?: Error;
  readonly loadOlder: () => Promise<void>;
  readonly respond: <TOutput = unknown>(
    inputResponses: readonly InputResponse[],
    options?: RespondTurnOptions<TOutput>
  ) => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly send: <TOutput = unknown>(
    message: string | UserContent,
    options?: SendTurnOptions<TOutput>
  ) => Promise<void>;
  readonly removeSend?: (id: string) => void;
  readonly retrySend?: (id: string) => void;
  readonly status: UseEveAgentStatus;
}
