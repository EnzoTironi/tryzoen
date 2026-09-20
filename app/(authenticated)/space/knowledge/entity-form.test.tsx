import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { emptyOntology } from "@shared/workspaces/ontology";
import type { ComponentProps } from "react";
import { OntologyEntityForm } from "./entity-form";

test("an entity display name cannot shadow a custom property named name", () => {
  const html = renderToStaticMarkup(
    <OntologyEntityForm
      graph={{
        ...emptyOntology,
        types: [
          {
            id: "person",
            name: "Pessoa",
            properties: [
              {
                id: "name",
                name: "Nome legal",
                type: "string",
                required: true,
              },
              { id: "active", name: "Ativo", type: "boolean", required: false },
            ],
          },
        ],
        relations: [],
        actions: [],
      }}
      pending={false}
      onSave={vi.fn<ComponentProps<typeof OntologyEntityForm>["onSave"]>()}
    />
  );
  const names = [...html.matchAll(/ name="([^"]+)"/g)].map((match) => match[1]);
  expect(names).toEqual(["name", "property:name", "property:active"]);
  expect(new Set(names).size).toBe(names.length);
});
