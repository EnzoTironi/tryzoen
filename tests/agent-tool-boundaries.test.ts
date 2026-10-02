import { isDisabledToolSentinel } from "eve/tools";
import { describe, expect, it } from "vitest";
import rootBash from "@agent/tools/bash";
import rootReadFile from "@agent/tools/read_file";
import rootWriteFile from "@agent/tools/write_file";
import workerQuestion from "@agent/subagents/browser-agent/tools/ask_question";
import workerBash from "@agent/subagents/browser-agent/tools/bash";
import workerLoadSkill from "@agent/subagents/browser-agent/tools/load_skill";
import workerPersonalInfo from "@agent/subagents/browser-agent/tools/personal_info";
import workerReadFile from "@agent/subagents/browser-agent/tools/read_file";
import workerTodo from "@agent/subagents/browser-agent/tools/todo";
import workerWebFetch from "@agent/subagents/browser-agent/tools/web_fetch";
import workerWebSearch from "@agent/subagents/browser-agent/tools/web_search";
import workerWriteFile from "@agent/subagents/browser-agent/tools/write_file";

describe("root and worker capabilities", () => {
  it("disables root sandbox access", () => {
    for (const tool of [rootBash, rootReadFile, rootWriteFile]) {
      expect(isDisabledToolSentinel(tool)).toBe(true);
    }
  });

  it("disables worker defaults outside delegated browser execution", () => {
    for (const tool of [
      workerQuestion,
      workerBash,
      workerLoadSkill,
      workerPersonalInfo,
      workerReadFile,
      workerTodo,
      workerWebFetch,
      workerWebSearch,
      workerWriteFile,
    ]) {
      expect(isDisabledToolSentinel(tool)).toBe(true);
    }
  });
});
