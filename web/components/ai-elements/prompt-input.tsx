"use client";

import type { ConversationDraft } from "@zoen/companion-ui/messages";

import { readFileDataUrl } from "@web/files/attachments";

import { useI18n } from "@zoen/companion-ui/i18n";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@web/components/ui/input-group";
import { Spinner } from "@web/components/ui/spinner";
import { cn } from "@web/components/class-names";
import type { ChatStatus, FileUIPart } from "ai";
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react";
import { LazyMotion, domMax, m, useReducedMotion } from "motion/react";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  ChangeEvent,
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
  PropsWithChildren,
  RefObject,
  SubmitEvent,
} from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ============================================================================
// Helpers
// ============================================================================

const MotionInputGroup = m.create(InputGroup);
const promptInputLayoutTransition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
};

const convertBlobUrlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await readFileDataUrl(blob);
  } catch {
    return null;
  }
};

const dragDataTransferSchema = z.custom<DataTransfer>(
  (value) => value !== null && value !== undefined
);

// ============================================================================
// Provider Context & Types
// ============================================================================

interface AttachmentsContext {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

interface TextInputContext {
  value: string;
  setInput: (v: string) => void;
  clear: () => void;
}

interface PromptInputControllerProps {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
  /** INTERNAL: Allows PromptInput to register its file textInput + "open" callback */
  registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void;
}

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null
);
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null
);

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController()."
    );
  }
  return ctx;
};

// Optional variants (do NOT throw). Useful for dual-mode components.
const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext);

type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string;
}>;

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export const PromptInputProvider = ({
  initialInput: initialTextInput = "",
  children,
}: PromptInputProviderProps) => {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput);
  const clearInput = useCallback(() => {
    setTextInput("");
  }, []);

  // ----- attachments state (global when wrapped)
  const [attachmentFiles, setAttachmentFiles] = useState<
    (FileUIPart & { id: string })[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef<(() => void) | undefined>(undefined);

  const add = useCallback((files: File[] | FileList) => {
    const incoming = [...files];
    if (incoming.length === 0) {
      return;
    }

    setAttachmentFiles((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        filename: file.name,
        id: nanoid(),
        mediaType: file.type,
        type: "file" as const,
        url: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.url) {
          URL.revokeObjectURL(f.url);
        }
      }
      return [];
    });
  }, []);

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles);

  useEffect(() => {
    attachmentsRef.current = attachmentFiles;
  }, [attachmentFiles]);

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(
    () => () => {
      for (const f of attachmentsRef.current) {
        if (f.url) {
          URL.revokeObjectURL(f.url);
        }
      }
    },
    []
  );

  const openFileDialog = useCallback(() => {
    openRef.current?.();
  }, []);

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef,
      files: attachmentFiles,
      openFileDialog,
      remove,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog]
  );

  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current;
      openRef.current = open;
    },
    []
  );

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      registerFileInput,
      attachments,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [textInput, clearInput, attachments, registerFileInput]
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
};

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

const PromptInputLayoutContext = createContext<{
  animateLayout: boolean;
  compact: boolean;
  expanded: boolean;
  setTextareaExpanded: (expanded: boolean) => void;
} | null>(null);

const usePromptInputAttachments = () => {
  // Prefer local context (inside PromptInput) as it has validation, fall back to provider
  const provider = useOptionalProviderAttachments();
  const local = useContext(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput or PromptInputProvider"
    );
  }
  return context;
};

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  // e.g., "image/*" or leave undefined for any
  accept?: string;
  multiple?: boolean;
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean;
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean;
  // Minimal constraints
  maxFiles?: number;
  // bytes
  maxFileSize?: number;
  /** Keep a single-line draft and the footer controls on one row. */
  compact?: boolean;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: ConversationDraft,
    event: SubmitEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  compact = false,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const { t } = useI18n();
  // Try to use a provider controller if present
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;

  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // ----- Local attachments (only used when no provider)
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const files = usingProvider ? controller.attachments.files : items;

  const shouldReduceMotion = useReducedMotion();
  const [textareaExpanded, setTextareaExpanded] = useState(false);
  const animateLayout = compact && !shouldReduceMotion;
  const expanded = compact && (textareaExpanded || files.length > 0);
  const layout = useMemo(
    () => ({ animateLayout, compact, expanded, setTextareaExpanded }),
    [animateLayout, compact, expanded]
  );

  // Keep a ref to files for cleanup on unmount (avoids stale closure)
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }

      const patterns = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      return patterns.some((pattern) => {
        if (pattern.endsWith("/*")) {
          // e.g: image/* -> image/
          const prefix = pattern.slice(0, -1);
          return f.type.startsWith(prefix);
        }
        return f.type === pattern;
      });
    },
    [accept]
  );

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: t("No files match the accepted types."),
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: t("All files exceed the maximum size."),
        });
        return;
      }

      setItems((prev) => {
        const maximum = z.number().safeParse(maxFiles);
        const capacity = maximum.success
          ? Math.max(0, maximum.data - prev.length)
          : undefined;
        const capped =
          capacity === undefined ? sized : sized.slice(0, capacity);
        if (capacity !== undefined && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: t("Too many files. Some were not added."),
          });
        }
        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            filename: file.name,
            id: nanoid(),
            mediaType: file.type,
            type: "file",
            url: URL.createObjectURL(file),
          });
        }
        return [...prev, ...next];
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError, t]
  );

  const removeLocal = useCallback((id: string) => {
    setItems((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  // Wrapper that validates files before calling provider's add
  const addWithProviderValidation = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: t("No files match the accepted types."),
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: t("All files exceed the maximum size."),
        });
        return;
      }

      const currentCount = files.length;
      const maximum = z.number().safeParse(maxFiles);
      const capacity = maximum.success
        ? Math.max(0, maximum.data - currentCount)
        : undefined;
      const capped = capacity === undefined ? sized : sized.slice(0, capacity);
      if (capacity !== undefined && sized.length > capacity) {
        onError?.({
          code: "max_files",
          message: t("Too many files. Some were not added."),
        });
      }

      if (capped.length > 0) {
        controller?.attachments.add(capped);
      }
    },
    [matchesAccept, maxFileSize, maxFiles, onError, files.length, controller, t]
  );

  const clearAttachments = useCallback(() => {
    if (usingProvider) {
      controller.attachments.clear();
      return;
    }
    setItems((previousItems) => {
      for (const file of previousItems) {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
      return [];
    });
  }, [usingProvider, controller]);

  const add = usingProvider ? addWithProviderValidation : addLocal;
  const remove = usingProvider ? controller.attachments.remove : removeLocal;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal;

  // Let provider know about our hidden file input so external menus can call openFileDialog()
  useEffect(() => {
    if (!usingProvider) {
      return;
    }
    controller.registerFileInput(inputRef, () => {
      inputRef.current?.click();
    });
  }, [usingProvider, controller]);

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return undefined;
    }
    if (globalDrop) {
      // when global drop is on, let the document-level handler own drops
      return undefined;
    }

    const onDragOver = (e: DragEvent) => {
      const dataTransfer = dragDataTransferSchema.safeParse(e.dataTransfer);
      if (!dataTransfer.success) return;
      if (dataTransfer.data.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      const dataTransfer = dragDataTransferSchema.safeParse(e.dataTransfer);
      if (!dataTransfer.success) return;
      if (dataTransfer.data.types.includes("Files")) {
        e.preventDefault();
      }
      if (dataTransfer.data.files.length > 0) {
        add(dataTransfer.data.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(() => {
    if (!globalDrop) {
      return undefined;
    }

    const onDragOver = (e: DragEvent) => {
      const dataTransfer = dragDataTransferSchema.safeParse(e.dataTransfer);
      if (!dataTransfer.success) return;
      if (dataTransfer.data.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      const dataTransfer = dragDataTransferSchema.safeParse(e.dataTransfer);
      if (!dataTransfer.success) return;
      if (dataTransfer.data.types.includes("Files")) {
        e.preventDefault();
      }
      if (dataTransfer.data.files.length > 0) {
        add(dataTransfer.data.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.url) {
            URL.revokeObjectURL(f.url);
          }
        }
      }
    },
    [usingProvider]
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      // Reset input value to allow selecting files that were previously removed
      event.currentTarget.value = "";
    },
    [add]
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files,
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog]
  );

  const handleSubmit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();

      const form = event.currentTarget;
      const text = usingProvider
        ? controller.textInput.value
        : (() => {
            const formData = new FormData(form);
            return z.string().catch("").parse(formData.get("message"));
          })();

      try {
        // Convert blob URLs to data URLs asynchronously
        const convertedFiles: FileUIPart[] = await Promise.all(
          files.map(async ({ id: _id, ...item }) => {
            if (item.url.startsWith("blob:")) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url);
              // If conversion failed, keep the original blob URL
              return {
                ...item,
                url: dataUrl ?? item.url,
              };
            }
            return item;
          })
        );

        await onSubmit({ files: convertedFiles, text }, event);
        clearAttachments();
        // Read the live form, including controlled inputs, to preserve edits.
        if (new FormData(form).get("message") === text) {
          if (usingProvider) controller.textInput.clear();
          else form.reset();
        }
      } catch {
        // Don't clear on error - user may want to retry
      }
    },
    [usingProvider, controller, files, onSubmit, clearAttachments]
  );

  // Render with or without local provider
  const inner = (
    <>
      <input
        accept={accept}
        aria-label={t("Upload files")}
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title={t("Upload files")}
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        ref={formRef}
        {...props}
      >
        <LazyMotion features={domMax}>
          <PromptInputLayoutContext.Provider value={layout}>
            <MotionInputGroup
              className={cn(
                "overflow-hidden",
                compact && "grid! items-center",
                compact &&
                  (expanded ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_auto]")
              )}
              data-compact={compact || undefined}
              data-expanded={expanded || undefined}
              layout={animateLayout}
              transition={{ layout: promptInputLayoutTransition }}
            >
              {children}
            </MotionInputGroup>
          </PromptInputLayoutContext.Provider>
        </LazyMotion>
      </form>
    </>
  );

  // Always provide LocalAttachmentsContext so children get validated add function
  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      {inner}
    </LocalAttachmentsContext.Provider>
  );
};

type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder,
  ref,
  value,
  defaultValue,
  ...props
}: PromptInputTextareaProps) => {
  const { t } = useI18n();
  const localizedPlaceholder = placeholder ?? t("What would you like to know?");

  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const layout = useContext(PromptInputLayoutContext);
  const [isComposing, setIsComposing] = useState(false);
  const [uncontrolledMeasurementValue, setUncontrolledMeasurementValue] =
    useState(() =>
      String(controller?.textInput.value ?? value ?? defaultValue ?? "")
    );
  const controlledValue = controller?.textInput.value ?? value;
  const measurementValue =
    controlledValue === undefined
      ? uncontrolledMeasurementValue
      : String(controlledValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);
  useImperativeHandle(ref, () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      throw new Error("Prompt input textarea ref initialized before mount");
    }
    return textarea;
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    const form = textarea?.form;
    if (!(textarea && form)) {
      return undefined;
    }

    const handleReset = () => {
      queueMicrotask(() => {
        setUncontrolledMeasurementValue(textarea.value);
      });
    };
    form.addEventListener("reset", handleReset);
    return () => {
      form.removeEventListener("reset", handleReset);
    };
  }, []);

  useLayoutEffect(() => {
    if (!layout?.compact) {
      return undefined;
    }

    const textarea = textareaRef.current;
    const measurement = measurementRef.current;
    const inputGroup = textarea?.closest<HTMLElement>(
      '[data-slot="input-group"]'
    );
    const footer = inputGroup?.querySelector<HTMLElement>(
      "[data-prompt-input-footer]"
    );
    if (!(textarea && measurement && inputGroup && footer)) {
      return undefined;
    }

    const measure = () => {
      if (measurementValue.includes("\n")) {
        layout.setTextareaExpanded(true);
        return;
      }

      const textareaStyle = getComputedStyle(textarea);
      measurement.style.fontFamily = textareaStyle.fontFamily;
      measurement.style.fontSize = textareaStyle.fontSize;
      measurement.style.fontStretch = textareaStyle.fontStretch;
      measurement.style.fontStyle = textareaStyle.fontStyle;
      measurement.style.fontWeight = textareaStyle.fontWeight;
      measurement.style.letterSpacing = textareaStyle.letterSpacing;
      measurement.style.textTransform = textareaStyle.textTransform;

      const footerStyle = getComputedStyle(footer);
      const footerChildren = [...footer.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          getComputedStyle(child).display !== "none"
      );
      const gap = Number.parseFloat(footerStyle.columnGap) || 0;
      const footerWidth =
        (Number.parseFloat(footerStyle.paddingLeft) || 0) +
        (Number.parseFloat(footerStyle.paddingRight) || 0) +
        footerChildren.reduce(
          (width, child) => width + child.getBoundingClientRect().width,
          0
        ) +
        Math.max(0, footerChildren.length - 1) * gap;
      const availableWidth =
        inputGroup.clientWidth -
        footerWidth -
        (Number.parseFloat(textareaStyle.paddingLeft) || 0) -
        (Number.parseFloat(textareaStyle.paddingRight) || 0);

      layout.setTextareaExpanded(
        measurement.getBoundingClientRect().width > availableWidth
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(inputGroup);
    observer.observe(footer);
    return () => {
      observer.disconnect();
    };
  }, [layout, measurementValue]);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      // Call the external onKeyDown handler first
      onKeyDown?.(e);

      // If the external handler prevented default, don't run internal logic
      if (e.defaultPrevented) {
        return;
      }

      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing) {
          return;
        }
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();

        // Check if the submit button is disabled before submitting
        const { form } = e.currentTarget;
        const submitButton = form?.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        );
        if (submitButton?.disabled) {
          return;
        }

        form?.requestSubmit();
      }

      // Remove last attachment when Backspace is pressed and textarea is empty
      if (
        e.key === "Backspace" &&
        e.currentTarget.value === "" &&
        attachments.files.length > 0
      ) {
        e.preventDefault();
        const lastAttachment = attachments.files.at(-1);
        if (lastAttachment) {
          attachments.remove(lastAttachment.id);
        }
      }
    },
    [onKeyDown, isComposing, attachments]
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const items = event.clipboardData.items;

      const files: File[] = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments]
  );

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const controlledProps = controller
    ? {
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(e.currentTarget.value);
          onChange?.(e);
        },
        value: controller.textInput.value,
      }
    : {
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          setUncontrolledMeasurementValue(e.currentTarget.value);
          onChange?.(e);
        },
        defaultValue,
        value,
      };

  const textarea = (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={localizedPlaceholder}
      ref={textareaRef}
      {...props}
      {...controlledProps}
    />
  );

  if (!layout?.compact) {
    return textarea;
  }

  return (
    <>
      <m.div
        className="min-w-0"
        layout={layout.animateLayout ? "position" : false}
        transition={{ layout: promptInputLayoutTransition }}
      >
        {textarea}
      </m.div>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible fixed top-0 left-0 w-max whitespace-pre"
        ref={measurementRef}
      >
        {measurementValue}
      </span>
    </>
  );
};

type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => {
  const layout = useContext(PromptInputLayoutContext);

  return (
    <InputGroupAddon
      align="block-end"
      className={cn(
        "justify-between gap-1",
        layout?.compact && "px-1.5!",
        layout?.compact &&
          !layout.expanded &&
          "col-start-2 row-start-1 w-auto! justify-end pb-1.5!",
        className
      )}
      data-prompt-input-footer=""
      {...props}
    />
  );
};

type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 items-center gap-1", className)}
    {...props}
  />
);

type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const { t } = useI18n();
  const layout = useContext(PromptInputLayoutContext);
  const isGenerating = status === "submitted" || status === "streaming";

  let Icon = <CornerDownLeftIcon className="size-4" />;

  if (status === "submitted") {
    Icon = <Spinner />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback<
    NonNullable<PromptInputSubmitProps["onClick"]>
  >(
    (e) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick]
  );

  const button = (
    <InputGroupButton
      aria-label={isGenerating ? t("Stop") : t("Submit")}
      className={cn(className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? "button" : "submit"}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );

  if (!layout?.compact) {
    return button;
  }

  return (
    <span className="size-8 shrink-0">
      <m.span
        className="absolute right-1.5 bottom-1.5 inline-flex"
        layout={layout.animateLayout ? "position" : false}
        transition={{ layout: promptInputLayoutTransition }}
      >
        {button}
      </m.span>
    </span>
  );
};
