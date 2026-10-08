"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStickToBottom } from "use-stick-to-bottom";
import { Plus, ArrowUp, Check, X, Brain, FileText, Square } from "lucide-react";
import { z } from "zod";
import { Button } from "@web/components/ui/button";
import { Textarea } from "@web/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@web/components/ui/select";
import {
  type pilotCommandSchema,
  pilotViewSchema,
} from "../../../server/mastra/contract";

export function PilotClient({
  initialView,
}: {
  initialView: z.output<typeof pilotViewSchema>;
}) {
  const [view, setView] = useState(initialView);
  const { scrollRef, contentRef } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async (conversationId?: string | null) => {
    const current = ++generation.current;
    try {
      const response = await fetch(
        "/api/pilot/mastra" +
          (conversationId ? `?conversation=${conversationId}` : "")
      );
      if (!response.ok)
        throw new Error("Não foi possível carregar a conversa.");
      const next = pilotViewSchema.parse(await response.json());
      if (generation.current === current) {
        setView(next);
        setError(null);
      }
    } catch {
      if (generation.current === current)
        setError("Não foi possível carregar. Tente novamente.");
    }
  }, []);
  const active = view.runs.find(
    (run) => run.status === "running" || run.status === "suspended"
  );
  const activeRunId = active?.runId;
  useEffect(() => {
    if (!activeRunId || busy) return undefined;
    const interval = setInterval(() => {
      void refresh(view.conversationId);
    }, 2500);
    return () => {
      clearInterval(interval);
    };
  }, [activeRunId, busy, view.conversationId, refresh]);

  async function command(input: z.output<typeof pilotCommandSchema>) {
    const current = ++generation.current;
    if (input.command !== "cancel") setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pilot/mastra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload: unknown = await response.json();
      if (!response.ok)
        throw new Error(z.object({ error: z.string() }).parse(payload).error);
      const next = pilotViewSchema.parse(payload);
      if (generation.current === current) setView(next);
      return next;
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error ? cause.message : "Não foi possível concluir."
        );
      return null;
    } finally {
      if (input.command !== "cancel") {
        setBusy(false);
        setPendingRun(null);
      }
    }
  }
  async function send() {
    if (!text.trim() || busy || active) return;
    let conversationId = view.conversationId;
    conversationId ??=
      (await command({ command: "create" }))?.conversationId ?? null;
    if (!conversationId) return;
    const input = text.trim();
    setText("");
    const runId = crypto.randomUUID();
    setPendingRun(runId);
    setView((previous) => ({
      ...previous,
      runs: [
        ...previous.runs,
        {
          runId,
          conversationId,
          input,
          createdAt: new Date().toISOString(),
          status: "running",
          plan: null,
          result: null,
        },
      ],
    }));
    await command({ command: "send", conversationId, runId, text: input });
  }
  return (
    <main className="flex h-dvh bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-5 border-r border-border bg-muted/25 p-5 max-md:hidden">
        <Link href="/" className="type-section-title">
          zoen
        </Link>
        <Button
          variant="outline"
          onClick={() => {
            void command({ command: "create" });
          }}
          disabled={busy}
        >
          <Plus />
          Nova conversa
        </Button>
        <nav className="flex flex-col gap-1" aria-label="Conversas">
          {view.conversations.map((conversation) => (
            <Button
              key={conversation.id}
              variant={
                view.conversationId === conversation.id ? "secondary" : "ghost"
              }
              className="justify-start overflow-hidden"
              disabled={busy}
              onClick={() => {
                void refresh(conversation.id);
              }}
            >
              <span className="truncate">{conversation.title}</span>
            </Button>
          ))}
        </nav>
        <p className="mt-auto type-caption text-muted-foreground">
          Memórias e notas são privadas da sua conta.
        </p>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="type-card-title">Converse com o Zoen</p>
            <p className="type-caption text-muted-foreground">
              Piloto · Mastra
            </p>
            {view.conversations.length > 0 && (
              <div className="mt-2 md:hidden">
                <Select
                  value={view.conversationId}
                  items={view.conversations.map((conversation) => ({
                    value: conversation.id,
                    label: conversation.title,
                  }))}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value) void refresh(value);
                  }}
                >
                  <SelectTrigger
                    aria-label="Conversa atual"
                    className="w-full max-w-60"
                  >
                    <SelectValue className="truncate" />
                  </SelectTrigger>
                  <SelectContent>
                    {view.conversations.map((conversation) => (
                      <SelectItem key={conversation.id} value={conversation.id}>
                        <span className="truncate">{conversation.title}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              void command({ command: "create" });
            }}
          >
            <Plus />
            Nova conversa
          </Button>
        </header>
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-8"
          aria-live="polite"
        >
          <div
            ref={contentRef}
            className="mx-auto flex max-w-2xl flex-col gap-6"
          >
            {!view.runs.length && (
              <div className="py-16">
                <h1 className="type-page-title mb-4">
                  O que vamos organizar hoje?
                </h1>
                <p className="type-supporting-body text-muted-foreground">
                  Posso lembrar uma preferência e preparar uma nota. Você revisa
                  cada alteração antes de aprovar.
                </p>
                <Button
                  className="mt-6"
                  variant="outline"
                  onClick={() => {
                    setText(
                      "Guarde para as próximas conversas que sou vegetariano."
                    );
                  }}
                >
                  <Brain />
                  Guardar uma preferência
                </Button>
              </div>
            )}
            {view.runs.map((run) => (
              <article key={run.runId} className="flex flex-col gap-4">
                <p className="type-supporting-body ml-10 self-end rounded-2xl bg-muted px-5 py-3 whitespace-pre-wrap">
                  {run.input}
                </p>
                {run.plan?.reply && (
                  <p className="type-supporting-body whitespace-pre-wrap">
                    {run.plan.reply}
                  </p>
                )}
                {run.plan?.action && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <p className="mb-3 flex items-center gap-2 type-card-title">
                      {run.plan.action.kind === "remember" ? (
                        <>
                          <Brain />
                          Guardar preferência
                        </>
                      ) : (
                        <>
                          <FileText />
                          Salvar nota
                        </>
                      )}
                    </p>
                    {run.plan.action.kind === "note" ? (
                      <>
                        <h2 className="mb-2 type-card-title">
                          {run.plan.action.title}
                        </h2>
                        <p className="type-supporting-body whitespace-pre-wrap">
                          {run.plan.action.content}
                        </p>
                        <p className="mt-4 type-caption text-muted-foreground">
                          Destino: biblioteca pessoal · Notas
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="type-supporting-body">
                          {run.plan.action.body.text}
                        </p>
                        <blockquote className="mt-4 border-l-2 border-border pl-3 type-caption text-muted-foreground">
                          Fonte: “{run.plan.action.body.sources[0]?.excerpt}”
                        </blockquote>
                      </>
                    )}
                    {run.status === "suspended" && (
                      <div className="mt-5 flex gap-2">
                        <Button
                          disabled={busy}
                          onClick={() => {
                            void command({
                              command: "decide",
                              runId: run.runId,
                              approved: true,
                            });
                          }}
                        >
                          <Check />
                          Aprovar
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            void command({
                              command: "decide",
                              runId: run.runId,
                              approved: false,
                            });
                          }}
                        >
                          <X />
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {run.status === "completed" &&
                  run.plan?.action?.kind === "note" && (
                    <a
                      className="type-label text-primary underline"
                      href={`/api/pilot/mastra/note?runId=${run.runId}`}
                    >
                      Baixar nota salva
                    </a>
                  )}
                {run.result && run.plan?.action && (
                  <div className="rounded-lg border border-border p-3 type-caption">
                    <p>{run.result.message}</p>
                    {run.result.receipt && (
                      <p className="mt-1 break-all text-muted-foreground">
                        Recibo: {run.result.receipt.operationId} · revisão{" "}
                        {run.result.receipt.revision.slice(0, 12)}
                      </p>
                    )}
                  </div>
                )}
                {run.status === "running" && (
                  <p className="type-caption text-muted-foreground">
                    Preparando sua resposta…
                  </p>
                )}
                {run.status === "cancelled" && (
                  <p className="type-caption text-muted-foreground">
                    Solicitação cancelada.
                  </p>
                )}
                {run.status === "failed" && (
                  <p className="type-caption text-destructive">
                    Não foi possível concluir esta solicitação. Tente novamente
                    em uma nova mensagem.
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
        <form
          className="mx-auto w-full max-w-2xl px-5 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {error && (
            <div
              role="alert"
              className="mb-3 flex items-center justify-between type-caption text-destructive"
            >
              <p>{error}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  void refresh(view.conversationId);
                }}
              >
                Recarregar
              </Button>
            </div>
          )}
          <label htmlFor="pilot-message" className="sr-only">
            Mensagem para o Zoen
          </label>
          <Textarea
            id="pilot-message"
            value={text}
            maxLength={8000}
            onChange={(event) => {
              setText(event.target.value);
            }}
            placeholder="Escreva para o Zoen…"
            disabled={busy || !!active}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="type-caption text-muted-foreground">
              Cada proposta aguarda sua revisão.
            </p>
            {pendingRun || active ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy && !pendingRun}
                onClick={() => {
                  const runId = pendingRun ?? active?.runId;
                  if (runId) void command({ command: "cancel", runId });
                }}
              >
                <Square />
                Cancelar
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!text.trim() || busy}
                aria-label="Enviar mensagem"
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
