// Run against the existing isolated RNWeb fixture only; no backend or sends.
// node tests/companion/composer-hit-targets.ts http://127.0.0.1:9437
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { z } from "zod";

const envelopeSchema = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  error: z.unknown().optional(),
  result: z.unknown().optional(),
  params: z.unknown().optional(),
});
const evaluationSchema = z.object({
  exceptionDetails: z.unknown().optional(),
  result: z.object({ value: z.unknown().optional() }),
});
const originalSchema = z.object({
  draft: z.string(),
  selection: z.tuple([z.number(), z.number()]),
  focused: z.boolean(),
  sends: z.number(),
});
const geometrySchema = z.looseObject({
  field: z.looseObject({ height: z.number() }),
  points: z
    .array(
      z.looseObject({ x: z.number(), y: z.number(), blocked: z.boolean() })
    )
    .length(2),
  focused: z.boolean(),
  sends: z.number(),
  overflow: z.boolean(),
});
const endpoint = process.argv[2] ?? "http://127.0.0.1:9437";
const targets = z
  .array(
    z.object({
      type: z.string(),
      url: z.string(),
      webSocketDebuggerUrl: z.string().optional(),
    })
  )
  .parse(await (await fetch(endpoint + "/json/list")).json());
const target = targets.find(
  (page) =>
    page.type === "page" && page.url.startsWith("http://127.0.0.1:4317/")
);
assert.ok(
  target?.webSocketDebuggerUrl,
  "Open the isolated agent-conversation fixture on4317 first"
);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
  ws.addEventListener(
    "open",
    () => {
      resolve();
    },
    { once: true }
  );
  ws.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const exceptions: unknown[] = [];
ws.addEventListener("message", (event) => {
  const result = envelopeSchema.parse(JSON.parse(String(event.data)));
  if (result.id) {
    const item = pending.get(result.id);
    if (item) {
      clearTimeout(item.timer);
      pending.delete(result.id);
      if (result.error) item.reject(new Error(JSON.stringify(result.error)));
      else item.resolve(result.result);
    }
  } else if (result.method === "Runtime.exceptionThrown")
    exceptions.push(result.params);
});
const call = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<unknown>((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => {
      pending.delete(next);
      reject(new Error("CDP timeout: " + method));
    }, 10000);
    pending.set(next, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
const evaluate = async (expression: string) => {
  const result = evaluationSchema.parse(
    await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
  );
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const settle = () =>
  evaluate(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,150))))"
  );
const replace = async (text: string) => {
  await evaluate(
    `(()=>{const input=document.querySelector('[data-testid=conversation-composer] textarea');input.focus();input.setSelectionRange(0,input.value.length)})()`
  );
  await call("Input.insertText", { text });
  await settle();
};
const report: {
  checks: {
    viewport: { width: number; height: number };
    geometry: z.infer<typeof geometrySchema>;
    passed: boolean;
  }[];
  exceptions: unknown[];
  error?: string;
} = { checks: [], exceptions };
let original: z.infer<typeof originalSchema> | undefined;
try {
  await call("Runtime.enable");
  assert.equal(
    await evaluate("!!window.qa?.ready"),
    true,
    "Requires simulated transport fixture"
  );
  original = originalSchema.parse(
    await evaluate(
      `(()=>{const input=document.querySelector('[data-testid=conversation-composer] textarea');if(!input)throw new Error('Agent conversation must be open');return {draft:input.value,selection:[input.selectionStart,input.selectionEnd],focused:document.activeElement===input,sends:qa.sent.length}})()`
    )
  );
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
    [320, 708],
    [390, 544],
  ] as const) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 720,
    });
    await settle();
    await replace("First line\nSecond line\nThird line\nFourth line");
    const geometry = geometrySchema.parse(
      await evaluate(
        `(()=>{const input=document.querySelector('[data-testid=conversation-composer] textarea');const field=input.parentElement.getBoundingClientRect();const plus=document.querySelector('[aria-label="Adicionar à mensagem"]').getBoundingClientRect();const column=document.querySelector('[data-testid="conversation-composer"]').firstElementChild.getBoundingClientRect();const points=[{x:plus.x+plus.width/2,y:field.y+8},{x:(plus.right+field.x)/2,y:field.y+field.height/2}];return {field:{x:field.x,y:field.y,width:field.width,height:field.height,bottom:field.bottom},plus:{x:plus.x,y:plus.y,width:plus.width,height:plus.height,bottom:plus.bottom},column:{x:column.x,width:column.width},points:points.map(point=>{const target=document.elementFromPoint(point.x,point.y);return {...point,blocked:!!target?.closest('[data-testid="conversation-composer"]'),label:target?.getAttribute('aria-label'),testId:target?.getAttribute('data-testid')}}),draft:input.value,focused:document.activeElement===input,sends:qa.sent.length,overflow:document.documentElement.scrollWidth>innerWidth}})()`
      )
    );
    const passed =
      geometry.field.height > 90 &&
      geometry.points.every((point) => !point.blocked) &&
      geometry.focused &&
      geometry.sends === original.sends &&
      !geometry.overflow;
    report.checks.push({ viewport: { width, height }, geometry, passed });
    assert.ok(
      passed,
      `Inner gaps must reach the timeline at${width}x${height}: ${JSON.stringify(geometry.points)}`
    );
    await evaluate(
      `window.qaInnerGapHit=undefined;document.addEventListener('pointerdown',event=>{window.qaInnerGapHit={blocked:!!event.target.closest('[data-testid="conversation-composer"]')}},{capture:true,once:true})`
    );
    const point = geometry.points.at(0);
    assert.ok(point);
    for (const type of ["mousePressed", "mouseReleased"])
      await call("Input.dispatchMouseEvent", {
        type,
        x: point.x,
        y: point.y,
        button: "left",
        clickCount: 1,
      });
    assert.equal(
      await evaluate("window.qaInnerGapHit?.blocked"),
      false,
      "Actual pointerdown must reach the timeline"
    );
    await evaluate(
      `document.querySelector('[data-testid=conversation-composer] textarea').focus()`
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-testid=conversation-composer] textarea').value`
      ),
      "First line\nSecond line\nThird line\nFourth line"
    );
  }
  assert.equal(exceptions.length, 0, "No browser exceptions");
  console.log(JSON.stringify(report));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (original) {
    await replace(original.draft);
    await evaluate(
      `(()=>{const input=document.querySelector('[data-testid=conversation-composer] textarea');input.setSelectionRange(${original.selection.join(",")});${original.focused ? "input.focus()" : "input.blur()"}})()`
    );
  }
  const reportPath = process.argv[3];
  if (reportPath)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  ws.close();
}
