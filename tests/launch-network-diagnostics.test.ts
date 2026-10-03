import { expect, test } from "vitest";
import type { EveEvalTurn } from "eve/evals";
import { networkDiscoveryDiagnostics } from "../evals/launch/network.eval";

const expectedUsername = "bruno_0123456789abcdef_bot";
const privateCanary = "PRIVATE_BRUNO_DO_NOT_EXPORT";

function discovery(
  input: EveEvalTurn["toolCalls"][number]["input"],
  output: EveEvalTurn["toolCalls"][number]["output"]
): EveEvalTurn["toolCalls"][number] {
  return {
    name: "network-bots",
    status: "completed",
    turnIndex: 0,
    input,
    output,
  };
}

test("retains empty and exact synthetic lookups without exporting profile or unrelated tool payloads", () => {
  const diagnostics = networkDiscoveryDiagnostics({
    expectedUsername,
    toolCalls: [
      discovery({ query: "" }, []),
      discovery(
        { query: `@${expectedUsername}`, authorization: privateCanary },
        [
          {
            username: expectedUsername,
            description: privateCanary,
            destination: { token: privateCanary },
          },
        ]
      ),
      {
        name: "send_message",
        status: "completed",
        turnIndex: 0,
        input: { text: privateCanary },
        output: privateCanary,
      },
    ],
  });
  expect(diagnostics).toEqual({
    expectedUsername,
    calls: [
      { query: "", resultCount: 0, expectedUsernameFound: false },
      {
        query: `@${expectedUsername}`,
        resultCount: 1,
        expectedUsernameFound: true,
      },
    ],
  });
  expect(JSON.stringify(diagnostics)).not.toContain(privateCanary);
});

test.each(["Bruno Zoen", privateCanary, "bruno_secret_provider_key"])(
  "redacts a nonallowlisted query and malformed result",
  (query) => {
    const diagnostics = networkDiscoveryDiagnostics({
      expectedUsername,
      toolCalls: [discovery({ query }, { error: privateCanary })],
    });
    expect(diagnostics.calls).toEqual([
      { query: null, resultCount: null, expectedUsernameFound: null },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(privateCanary);
  }
);

test("does not export malformed or oversized discovery results", () => {
  const diagnostics = networkDiscoveryDiagnostics({
    expectedUsername,
    toolCalls: [
      discovery({ query: "bruno" }, [{ description: privateCanary }]),
      discovery(
        { query: "bruno" },
        Array.from({ length: 21 }, () => ({
          username: expectedUsername,
          description: privateCanary,
        }))
      ),
    ],
  });
  expect(diagnostics.calls).toEqual([
    { query: "bruno", resultCount: null, expectedUsernameFound: null },
    { query: "bruno", resultCount: null, expectedUsernameFound: null },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain(privateCanary);
});
