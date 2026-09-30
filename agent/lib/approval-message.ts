import { approvalTextSchema } from "@zoen/companion-ui/approval";

export const approvalMessageSchema = approvalTextSchema.describe(
  "Write supplementary context directly to the user in their language and the conversation's tone. Explain why the action is proposed and ask for their decision naturally. The channel separately discloses the complete stored action, including its exact recipients, destination and content; this message cannot replace or change that payload. Do not separately send the proposal or claim the action already happened. Do not use commands, request codes or tool JSON. The complete disclosure must fit the limit; propose a smaller action if it cannot."
);
