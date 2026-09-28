import { expect, it } from "vitest";
import {
  documentMarkdown,
  needsSourceEditor,
} from "../../packages/companion-ui/src/editor/markdown";

it("round-trips headings, marks, nested lists, links and quotes without losing document structure", () => {
  const source = `# Soul

## Values

### Daily habits

Be **helpful**, *clear*, and ~~never~~ use \`care\`.

- Listen first
  - Ask a focused question
- Act carefully

3. Read the plan
4. Follow [the guide](https://example.com/guide)

> Leave space for reflection.
`;
  const document = documentMarkdown.parse(source);
  expect(needsSourceEditor(source)).toBe(false);
  expect(needsSourceEditor(source, true)).toBe(false);
  const saved = documentMarkdown.serialize(document);
  expect(documentMarkdown.parse(saved)).toEqual(document);
  expect(saved).toContain("**helpful**");
  expect(saved).toContain("https://example.com/guide");
  expect(saved).toContain("3. Read the plan");
});

it.each([
  "---\nname: daily-review\ndescription: Keep this metadata intact\n---\n# Daily review",
  '+++\nname = "daily-review"\n+++\n# Daily review',
  "<!-- retain this comment -->\n# Soul",
  "<section>Keep me</section>",
  "![A diagram](https://example.com/image.png)",
  "| Name | Value |\n| --- | --- |\n| Goal | Read |",
  "- [x] Finished\n- [ ] Upcoming",
])("keeps unsupported content in the source editor: %s", (source) => {
  expect(needsSourceEditor(source)).toBe(true);
  expect(needsSourceEditor(source, true)).toBe(true);
});

it.each(["```ts\nconst plan = 'read';\n```", "Before\n\n---\n\nAfter"])(
  "preserves native-unsupported blocks while allowing the web editor: %s",
  (source) => {
    expect(needsSourceEditor(source)).toBe(false);
    expect(needsSourceEditor(source, true)).toBe(true);
    const document = documentMarkdown.parse(source);
    expect(
      documentMarkdown.parse(documentMarkdown.serialize(document))
    ).toEqual(document);
  }
);

it("supports empty documents and escaped Markdown characters", () => {
  for (const source of ["", "Literal \\*stars\\* and \\[brackets\\]."]) {
    const document = documentMarkdown.parse(source);
    expect(
      documentMarkdown.parse(documentMarkdown.serialize(document))
    ).toEqual(document);
  }
});

it("keeps identity fields separate from the biography after a visual edit", () => {
  const document = documentMarkdown.parse(
    "# Identity\n\nName: Zoen\nA thoughtful assistant."
  );
  const saved = documentMarkdown.serialize(document);
  expect(saved).toContain("Name: Zoen  \nA thoughtful assistant.");
  expect(documentMarkdown.parse(saved)).toEqual(document);
});
