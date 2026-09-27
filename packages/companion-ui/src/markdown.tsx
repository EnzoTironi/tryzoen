import { useMemo } from "react";
import { Text } from "react-native";
import Markdown, { Renderer } from "react-native-marked";
import { colors } from "./theme";

import { isSafeWebLink } from "./links";

class AssistantRenderer extends Renderer {
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
    return isSafeWebLink(uri) ? (
      super.image(...args)
    ) : (
      <Text key={this.getKey()}>{alt ?? "Image"}</Text>
    );
  }
}

export function AssistantMarkdown({ text }: { readonly text: string }) {
  const renderer = useMemo(() => new AssistantRenderer(), []);
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
