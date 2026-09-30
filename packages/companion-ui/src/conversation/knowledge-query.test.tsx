import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { EveDynamicToolPart } from "eve/react";
import { beforeEach, expect, test, vi } from "vitest";
import { KnowledgeQueryCard } from "./knowledge-query";
import type { ActionButton } from "../button";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => ({ ChartColumn: () => null }));
const buttons = vi.hoisted(
  () => new Map<string, ComponentProps<typeof ActionButton>>()
);
vi.mock("../button", () => ({
  ActionButton: (props: ComponentProps<typeof ActionButton>) => {
    buttons.set(props.children, props);
    return <button>{props.children}</button>;
  },
}));
const part = {
  type: "dynamic-tool",
  toolCallId: "synthetic-query",
  toolName: "workspace_knowledge_query",
  state: "output-available",
  output: {
    rows: [{ total: 30 }],
    manifest: {
      id: "ccf2bc58-c85f-47bc-8210-e76cda808966",
      engine: "malloy-0.0.434/pglite-snapshot",
      inputSha256: "a".repeat(64),
      sqlSha256: "b".repeat(64),
      startedAt: "2026-09-30T09:00:00.000Z",
      completedAt: "2026-09-30T09:00:01.000Z",
      actor: "synthetic",
      workspaceId: "personal:synthetic",
      revision: "c".repeat(40),
      query: "knowledge/queries/total.json",
      arguments: {},
      sql: "SELECT PRIVATE_SQL",
      sources: [{ path: "knowledge/data/items.csv", sha256: "d".repeat(64) }],
      freshness: "Published CSV snapshot; live provider freshness is unknown",
      limits: {
        rows: 100,
        resultBytes: 65536,
        deadlineMs: 15000,
        memoryBytes: 1610612736,
        memoryController: "cgroup-v2",
      },
    },
  },
} satisfies EveDynamicToolPart;
beforeEach(() => {
  buttons.clear();
});

test("keeps a verified calculation compact and leaves execution details closed", () => {
  const markup = renderToStaticMarkup(<KnowledgeQueryCard part={part} />);
  expect(markup).toContain("1 linha · calculado");
  expect(markup).toContain("Abrir análise total");
  expect(markup).not.toContain("Ver resultado");
  expect(markup).not.toContain("PRIVATE_SQL");
  expect(markup).not.toContain("knowledge/data/items.csv");
});

test.each([
  ["input-available", "Calculando…"],
  ["output-error", "Não foi possível concluir a análise"],
  ["output-denied", "Não autorizado"],
] as const)("never labels %s as a successful calculation", (state, label) => {
  const markup = renderToStaticMarkup(
    <KnowledgeQueryCard part={{ ...part, state }} />
  );
  expect(markup).toContain(label);
  expect(markup).not.toContain("calculado");
  expect(buttons.has("Ver resultado")).toBe(false);
});

test("does not show a successful result when the persisted transport is malformed", () => {
  const markup = renderToStaticMarkup(
    <KnowledgeQueryCard part={{ ...part, output: { rows: [{ total: 30 }] } }} />
  );
  expect(markup).toContain("Resultado indisponível");
  expect(buttons.has("Ver resultado")).toBe(false);
});
