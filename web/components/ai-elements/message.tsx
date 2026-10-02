"use client";

import { useI18n } from "@zoen/companion-ui/i18n";

import { cn } from "@web/components/class-names";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { Streamdown, type Components } from "streamdown";
import { z } from "zod";
import { isBrowserImageArtifactUrl } from "@shared/browser/artifact";

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-3 overflow-hidden type-supporting-body",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };
const streamdownComponents: Components = { img: ArtifactMessageImage };

export function ArtifactMessageImage({
  alt,
  className,
  node: _node,
  src,
  ...props
}: ComponentProps<"img"> & { readonly node?: unknown }) {
  const { t } = useI18n();
  void _node;
  const parsedSource = z.string().safeParse(src);
  if (!parsedSource.success || !isBrowserImageArtifactUrl(parsedSource.data)) {
    return (
      <span className="text-muted-foreground">
        {t("Image not displayed:")} {alt ?? t("external image")}
      </span>
    );
  }

  return (
    <a href={parsedSource.data} rel="noreferrer" target="_blank">
      {/* oxlint-disable-next-line nextjs/no-img-element -- validated runtime browser image URL */}
      <img
        {...props}
        alt={alt ?? t("Browser image")}
        className={cn(
          "my-3 max-h-[32rem] w-auto max-w-full rounded-lg border bg-muted object-contain",
          className
        )}
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={src}
      />
    </a>
  );
}

// Streamdown's link safety is on by default and interrogates every link with
// an "Open external link?" modal — including relative links into our own app.
// Keep the modal for genuinely external URLs only.
const streamdownLinkSafety = {
  enabled: true,
  onLinkCheck: (url: string) => {
    try {
      return (
        new URL(url, window.location.href).origin === window.location.origin
      );
    } catch {
      return false;
    }
  },
};

// Streamdown already memoizes its own output. Once a response settles, switch
// out of its incremental block renderer so the completed text is committed
// synchronously instead of retaining an earlier streamed render.
export const MessageResponse = ({
  className,
  isAnimating = false,
  mode,
  ...props
}: MessageResponseProps) => (
  <Streamdown
    className={cn(
      "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
      className
    )}
    components={streamdownComponents}
    isAnimating={isAnimating}
    linkSafety={streamdownLinkSafety}
    mode={mode ?? (isAnimating ? "streaming" : "static")}
    plugins={streamdownPlugins}
    {...props}
  />
);
