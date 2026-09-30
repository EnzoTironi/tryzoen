import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode } from "react";
import type { Pressable } from "react-native";
import type { EveDynamicToolPart } from "eve/react";
import { beforeEach, expect, test, vi } from "vitest";
import { KnowledgeQueryCard } from "./knowledge-query";
import type { SheetSurface } from "../sheet";

const controls = vi.hoisted(() => ({
  values: new Map<number, unknown>(),
  cursor: 0,
  buttons: new Map<string, ComponentProps<typeof Pressable>>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = controls.cursor++;
    if (!controls.values.has(index)) {
      controls.values.set(
        index,
        typeof initial === "function"
          ? Reflect.apply(initial, undefined, [])
          : initial
      );
    }
    return [
      controls.values.get(index),
      (value: unknown) => {
        controls.values.set(
          index,
          typeof value === "function"
            ? Reflect.apply(value, undefined, [controls.values.get(index)])
            : value
        );
      },
    ];
  },
}));
vi.mock("react-native", async () => ({
  ...(await vi.importActual<typeof import("react-native")>("react-native-web")),
  useWindowDimensions: () => ({
    width: 1024,
    height: 800,
    scale: 1,
    fontScale: 1,
  }),
  Pressable: (props: ComponentProps<typeof Pressable>) => {
    if (props.accessibilityLabel)
      controls.buttons.set(props.accessibilityLabel, props);
    const children: ReactNode =
      typeof props.children === "function"
        ? props.children({ pressed: false })
        : props.children;
    return (
      <button
        aria-label={props.accessibilityLabel}
        aria-expanded={props["aria-expanded"]}
        disabled={props.disabled}
      >
        {children}
      </button>
    );
  },
}));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("../sheet", () => ({
  SheetSurface: ({ title, children }: ComponentProps<typeof SheetSurface>) => (
    <section aria-label={title}>{children}</section>
  ),
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
function render(value: EveDynamicToolPart = part) {
  controls.cursor = 0;
  controls.buttons.clear();
  return renderToStaticMarkup(<KnowledgeQueryCard part={value} />);
}
function press(label: string) {
  const button = controls.buttons.get(label);
  if (!button?.onPress) throw new Error(`Missing action: ${label}`);
  Reflect.apply(button.onPress, undefined, [{}]);
}
function open(value: EveDynamicToolPart = part) {
  render(value);
  const button = [...controls.buttons.keys()].find((label) =>
    label.startsWith("Abrir análise")
  );
  if (!button) throw new Error("Missing analysis opener");
  press(button);
  return render(value);
}
beforeEach(() => {
  controls.values.clear();
  controls.buttons.clear();
  controls.cursor = 0;
});

test("keeps a verified calculation compact and leaves execution details closed", () => {
  const markup = render();
  expect(markup).toContain("1 linha · calculado");
  expect(markup).toContain("Abrir análise Total");
  expect(markup).not.toContain("Ver resultado");
  expect(markup).not.toContain("PRIVATE_SQL");
  expect(markup).not.toContain("knowledge/data/items.csv");
});

test.each([
  ["input-available", "Calculando…"],
  ["output-error", "Não foi possível concluir a análise"],
  ["output-denied", "Não autorizado"],
] as const)("never labels %s as a successful calculation", (state, label) => {
  const markup = render({ ...part, state });
  expect(markup).toContain(label);
  expect(markup).not.toContain("calculado");
  expect(controls.buttons.get("Abrir análise Análise")?.disabled).toBe(true);
});

test("does not show a successful result when the persisted transport is malformed", () => {
  const markup = render({ ...part, output: { rows: [{ total: 30 }] } });
  expect(markup).toContain("Resultado indisponível");
  expect(controls.buttons.get("Abrir análise Análise")?.disabled).toBe(true);
});

test("opens results first with an honest freshness state and accessible table headings", () => {
  const markup = open();
  expect(markup).toContain("1 resultado");
  expect(markup).toContain("Atualização da origem desconhecida");
  expect(markup).toContain('role="table"');
  expect(markup).toContain('role="columnheader"');
  expect(markup).toContain("30");
  expect(markup).not.toContain("PRIVATE_SQL");
  expect(controls.buttons.get("Fontes da análise")?.["aria-expanded"]).toBe(
    false
  );
  expect(controls.buttons.get("Detalhes da execução")?.["aria-expanded"]).toBe(
    false
  );
});

test("humanizes only known status values in status columns and preserves the raw result", () => {
  const query = {
    ...part,
    output: {
      ...part.output,
      rows: [
        {
          task: "Prepare product captures",
          owner: "Imani Brooks",
          status: "in_progress",
          arbitrary: "in_review",
        },
        {
          task: "Review story outline",
          owner: "Maya Chen",
          status: "in_review",
          arbitrary: "in_progress",
        },
        {
          task: "Unknown value",
          owner: "Theo Park",
          status: "internal_custom_value",
          arbitrary: "done",
        },
      ],
      manifest: {
        ...part.output.manifest,
        query: "knowledge/queries/open-launch-tasks.json",
      },
    },
  };
  const original = JSON.stringify(query.output);
  const markup = open(query);
  expect(markup).toContain("Open launch tasks");
  expect(markup).toContain("Tarefa");
  expect(markup).toContain("Responsável");
  expect(markup).toContain("Em andamento (in_progress)");
  expect(markup).toContain("Em revisão (in_review)");
  expect(markup).toContain("internal_custom_value");
  expect(markup).toContain(">in_progress<");
  expect(markup).toContain(">in_review<");
  expect(JSON.stringify(query.output)).toBe(original);
});

test("opens compact source citations independently of technical execution details", () => {
  open();
  press("Fontes da análise");
  const markup = render();
  expect(markup).toContain("knowledge/data/items.csv");
  expect(markup).toContain("Items");
  expect(markup).not.toContain(part.output.manifest.sources[0]?.sha256);
  expect(markup).not.toContain("PRIVATE_SQL");
  expect(controls.buttons.get("Fontes da análise")?.["aria-expanded"]).toBe(
    true
  );
  press("Fontes da análise");
  expect(render()).not.toContain("knowledge/data/items.csv");
});

test("keeps full provenance, hashes, raw values and SQL available when deliberately expanded", () => {
  open();
  press("Detalhes da execução");
  const markup = render();
  for (const value of [
    part.output.manifest.actor,
    part.output.manifest.workspaceId,
    part.output.manifest.id,
    part.output.manifest.revision,
    part.output.manifest.inputSha256,
    part.output.manifest.sqlSha256,
    part.output.manifest.sources[0]?.sha256,
    part.output.manifest.query,
    part.output.manifest.engine,
    part.output.manifest.sql,
    part.output.manifest.freshness,
  ]) {
    expect(markup).toContain(value);
  }
  expect(markup).toContain("1610612736");
  expect(markup).toContain("Dados originais");
  expect(controls.buttons.get("Detalhes da execução")?.["aria-expanded"]).toBe(
    true
  );
  press("Detalhes da execução");
  expect(render()).not.toContain("PRIVATE_SQL");
});

test("renders empty results without manufacturing a table or losing provenance access", () => {
  const markup = open({ ...part, output: { ...part.output, rows: [] } });
  expect(markup).toContain("Nenhum resultado");
  expect(markup).toContain("0 resultados");
  expect(markup).not.toContain('role="table"');
  expect(controls.buttons.has("Fontes da análise")).toBe(true);
});

test("paginates presentation without truncating the underlying result", () => {
  const rows = Array.from({ length: 45 }, (_, index) => ({
    task: `Record ${index}`,
  }));
  const query = { ...part, output: { ...part.output, rows } };
  expect(open(query)).not.toContain("Record 20");
  press("Mostrar mais linhas");
  expect(render(query)).toContain("Record 39");
  expect(render(query)).not.toContain("Record 40");
  press("Mostrar mais linhas");
  expect(render(query)).toContain("Record 44");
  expect(controls.buttons.has("Mostrar mais linhas")).toBe(false);
  expect(query.output.rows).toEqual(rows);
});

test("preserves null, boolean and nested raw values and columns introduced by later rows", () => {
  const query = {
    ...part,
    output: {
      ...part.output,
      rows: [
        { task: "First", optional: null, enabled: false },
        { task: "Second", late_field: { nested: 12 }, enabled: true },
      ],
    },
  };
  const markup = open(query);
  expect(markup).toContain("Late field");
  expect(markup).toContain("—");
  expect(markup).toContain(">false<");
  expect(markup).toContain(">true<");
  expect(markup).toContain("nested");
  expect(markup).toContain("12");
});

test("closes the result panel through its named action", () => {
  open();
  press("Fechar análise Total");
  expect(render()).not.toContain('role="table"');
});
