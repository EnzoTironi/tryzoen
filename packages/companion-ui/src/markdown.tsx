import { useMemo } from "react";
import { Text } from "react-native";
import Markdown, { Renderer } from "react-native-marked";
import { colors } from "./theme";

import { isSafeWebLink } from "./links";

class AssistantRenderer extends Renderer {
  constructor(private readonly allowImages: boolean) {
    super();
  }
  override link(...args: Parameters<Renderer["link"]>) {
    const [children, href, style] = args;
    return isSafeWebLink(href) ? (
      super.link(...args)
    ) : (
      <Text key={this.getKey()} style={style}>
        {children}
      </Text>
    );
  }

  override image(...args: Parameters<Renderer["image"]>) {
    const [uri, alt] = args;
    return this.allowImages && isSafeWebLink(uri) ? (
      super.image(...args)
    ) : (
      <Text key={this.getKey()}>{alt ?? "Image"}</Text>
    );
  }
}

export function AssistantMarkdown({
  text,
  allowImages = true,
}: {
  readonly text: string;
  /** Private documents can render their text without contacting image hosts. */
  readonly allowImages?: boolean;
}) {
  const renderer = useMemo(
    () => new AssistantRenderer(allowImages),
    [allowImages]
  );
  return (
    <Markdown
      value={text}
      renderer={renderer}
      flatListProps={{
        scrollEnabled: false,
        style: { backgroundColor: "transparent" },
      }}
      theme={{
        colors: {
          text: colors.ink,
          code: colors.wash,
          link: colors.accent,
          border: colors.line,
        },
      }}
    />
  );
}
