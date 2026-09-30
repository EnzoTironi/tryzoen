import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Markdown, { Renderer } from "react-native-marked";
import { systemFont, useColors } from "./theme";

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
  compact = false,
  outgoing = false,
}: {
  readonly text: string;
  /** Private documents can render their text without contacting image hosts. */
  readonly allowImages?: boolean;
  /** Message bubbles own their outer padding; documents keep block spacing. */
  readonly compact?: boolean;
  readonly outgoing?: boolean;
}) {
  const colors = useColors();
  const renderer = useMemo(
    () => new AssistantRenderer(allowImages),
    [allowImages]
  );
  return (
    <Markdown
      value={text}
      renderer={renderer}
      styles={{
        ...(compact ? messageStyles : undefined),
        text: { fontFamily: systemFont },
        link: { fontFamily: systemFont, textDecorationLine: "underline" },
        codespan: { color: colors.ink },
        codeText: { color: colors.ink },
      }}
      flatListProps={{
        scrollEnabled: false,
        style: { backgroundColor: "transparent" },
        ItemSeparatorComponent: compact ? MessageBlockSeparator : undefined,
      }}
      theme={{
        colors: {
          text: outgoing ? colors.selectedInk : colors.ink,
          code: colors.wash,
          link: outgoing ? colors.selectedInk : colors.accent,
          border: outgoing ? colors.selectedInk : colors.line,
        },
      }}
    />
  );
}

const messageStyles = StyleSheet.create({
  paragraph: { paddingVertical: 0 },
});

function MessageBlockSeparator() {
  return <View style={{ height: 10 }} />;
}
