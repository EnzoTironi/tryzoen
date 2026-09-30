import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Image } from "react-native";
import { beforeEach, expect, it, vi } from "vitest";
import { AttachmentCard } from "./card";

const state = vi.hoisted(() => ({
  images: [] as ComponentProps<typeof Image>[],
  getSize: vi.fn<typeof Image.getSize>(),
  platform: "web",
}));
vi.mock("react-native", async () => {
  const native =
    await vi.importActual<typeof import("react-native")>("react-native-web");
  return {
    ...native,
    Platform: {
      ...native.Platform,
      get OS() {
        return state.platform;
      },
    },
    Image: Object.assign(
      (props: ComponentProps<typeof Image>) => {
        state.images.push(props);
        return <span data-preview={props.accessibilityLabel} />;
      },
      { getSize: state.getSize }
    ),
  };
});
vi.mock("lucide-react-native", () => import("lucide-react"));

const file: ComponentProps<typeof AttachmentCard>["file"] = {
  type: "file",
  mediaType: "image/webp",
  filename: "parque.webp",
  url: "data:image/webp;base64,YWJjZA==",
};
beforeEach(() => {
  state.images = [];
  state.getSize.mockReset();
  state.platform = "web";
});
function load(nativeEvent: object) {
  renderToStaticMarkup(<AttachmentCard file={file} />);
  const onLoad = state.images[0]?.onLoad;
  if (!onLoad) throw new Error("Image preview missing");
  Reflect.apply(onLoad, undefined, [{ nativeEvent }]);
}
it("reads web image dimensions when the load event has no native source", () => {
  expect(() => {
    load({});
  }).not.toThrow();
  expect(state.getSize).toHaveBeenCalledExactlyOnceWith(
    file.url,
    expect.any(Function),
    expect.any(Function)
  );
});
it("keeps native load dimensions without an extra size request", () => {
  state.platform = "ios";
  expect(() => {
    load({ source: { width: 600, height: 900 } });
  }).not.toThrow();
  expect(state.getSize).not.toHaveBeenCalled();
});
it("does not preview or resolve image sizes for an invalid inline attachment", () => {
  const html = renderToStaticMarkup(
    <AttachmentCard
      file={{ ...file, url: "https://example.com/parque.webp" }}
    />
  );
  expect(state.images).toHaveLength(0);
  expect(state.getSize).not.toHaveBeenCalled();
  expect(html).toContain("parque.webp");
});
