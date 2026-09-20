const messages = {
  unavailable:
    "This tool is unavailable in the current scope. Use the native tools available in this session; do not invent tool names.",
  invalid_input:
    "Invalid tool arguments. Check this tool's input schema and correct the arguments before retrying.",
  execution_failed:
    "The tool could not complete. No successful result is confirmed. Do not repeat an uncertain write.",
  uncertain:
    "The remote action may already have completed. Automatic retry is blocked. Ask the user to verify the result in the connected service before authorizing a new action; never retry with a new call ID on your own.",
  conflict:
    "The workspace revision changed. Read workspace_files_list and reconcile with the current revision before retrying. expectedRevision is the WORKSPACE head, not the target file revision; null is valid only for an entirely empty workspace.",
  not_found:
    "This file does not exist. Read workspace_files_list for the current workspace revision and available paths.",
};

export class ToolUnavailable extends Error {
  readonly _tag = "ToolUnavailable";
  declare readonly reason:
    | "unavailable"
    | "invalid_input"
    | "execution_failed"
    | "uncertain"
    | "conflict"
    | "not_found";
  constructor(input: {
    readonly reason:
      | "unavailable"
      | "invalid_input"
      | "execution_failed"
      | "uncertain"
      | "conflict"
      | "not_found";
  }) {
    super("ToolUnavailable");
    this.name = "ToolUnavailable";
    Object.assign(this, input);
  }
  override get message() {
    return messages[this.reason];
  }
}
