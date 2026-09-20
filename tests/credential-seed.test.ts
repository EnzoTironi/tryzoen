import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

test("deployment seeding preserves a refreshed credential across restarts and accepts explicit rotation", () => {
  const directory = mkdtempSync(join(tmpdir(), "zoen-auth-seed-"));
  const path = join(directory, "codex", "auth.json");
  const initial = JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "synthetic-initial",
      refresh_token: "synthetic-refresh",
      id_token: "synthetic-id",
    },
  });
  const renewed = JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "synthetic-renewed",
      refresh_token: "synthetic-rotated",
      id_token: "synthetic-id",
    },
  });
  const replacement = JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "synthetic-replacement",
      refresh_token: "synthetic-new-grant",
      id_token: "synthetic-id",
    },
  });
  try {
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: initial,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(initial);
    writeFileSync(path, renewed);
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: initial,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(renewed);
    expect(
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: replacement,
        encoding: "utf8",
      })
    ).toBe("");
    expect(readFileSync(path, "utf8")).toBe(replacement);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() =>
      execFileSync("sh", ["scripts/seed-credential.sh", path], {
        input: '{"accessToken":"obsolete-format-secret"}',
        stdio: ["pipe", "pipe", "pipe"],
      })
    ).toThrow(
      "CODEX_AUTH_JSON must contain a native managed ChatGPT auth.json"
    );
    expect(readFileSync(path, "utf8")).toBe(replacement);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
