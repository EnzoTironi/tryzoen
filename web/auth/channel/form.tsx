"use client";

import type { z } from "zod";
import { useI18n } from "@web/i18n/context";
import type { ChannelAuthorizationStatus } from "@web/auth/channel/client";
import { ChannelAuthorizationError } from "@web/auth/channel/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  channelChallengeSchema,
  deviceBoundSchema,
  channelChallengeRequestSchema,
  channelProviderSchema,
} from "@shared/identity/channel-auth";
import {
  checkChannelAuthorization,
  channelAuthorizationPollIntervalMs,
  channelFailureMessage,
  completeChannelAuthorization,
  channelHttpError,
  channelPollFailure,
  safeCallbackUrl,
  reauthenticationDestination,
  startChannelAuthorization,
} from "@web/auth/channel/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { ChannelStatus } from "./status";
import { authClient } from "@web/auth/client";
export function ChannelAuthForm({
  callbackUrl,
  purpose,
  children,
  onComplete,
}: {
  readonly callbackUrl: string;
  readonly purpose: z.output<typeof channelChallengeRequestSchema>["purpose"];
  readonly onComplete?: (
    channel: z.output<typeof channelProviderSchema>
  ) => void;
  readonly children?: (request: {
    start: (channel: z.output<typeof channelProviderSchema>) => void;
    busy: boolean;
  }) => ReactNode;
}) {
  const { t } = useI18n();
  const [challenge, setChallenge] =
    useState<z.output<typeof channelChallengeSchema>>();
  const action = useAuthorizationRequest();
  function start(channel: z.output<typeof channelProviderSchema>) {
    action.run(
      (signal) => startChannelAuthorization(channel, purpose, signal),
      (result) => {
        if ("conversationUrl" in result)
          window.location.assign(result.conversationUrl);
        else setChallenge(result);
      }
    );
  }
  if (challenge)
    return (
      <PendingAuthorization
        key={challenge.id}
        challenge={challenge}
        callbackUrl={callbackUrl}
        purpose={purpose}
        onComplete={onComplete}
        onRestart={() => {
          setChallenge(undefined);
        }}
      />
    );
  return (
    <div className="space-y-3">
      {children ? (
        children({
          start,
          busy: action.busy,
        })
      ) : (
        <ChannelChoices purpose={purpose} start={start} busy={action.busy} />
      )}
      {action.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t(channelFailureMessage(action.error, purpose))}
          </AlertDescription>
        </Alert>
      ) : null}
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl={callbackUrl} />
      ) : null}
    </div>
  );
}
function ChannelChoices({
  purpose,
  start,
  busy,
}: {
  readonly purpose: z.output<typeof channelChallengeRequestSchema>["purpose"];
  readonly start: (channel: z.output<typeof channelProviderSchema>) => void;
  readonly busy: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          start("telegram");
        }}
        type="button"
      >
        {busy
          ? purpose === "login"
            ? t("Preparing sign-in…")
            : t("Preparing link…")
          : purpose === "login"
            ? t("Continue with Telegram")
            : t("Link Telegram")}
      </Button>
      <Button
        className="w-full"
        size="lg"
        disabled={busy}
        onClick={() => {
          start("kapso");
        }}
        type="button"
        variant="outline"
      >
        {purpose === "login" ? t("Continue with WhatsApp") : t("Link WhatsApp")}
      </Button>
      <p className="type-caption text-muted-foreground">
        {purpose === "login"
          ? t(
              "Choose a messenger, confirm this browser’s sign-in in chat, then return here. No phone number or password to enter."
            )
          : t(
              "Choose the messenger account you want to link. Confirm the link in that chat, then return here to finish. A recent sign-in is required."
            )}
      </p>
    </>
  );
}
export function PendingAuthorization({
  challenge,
  callbackUrl,
  purpose,
  onRestart,
  onComplete,
}: {
  readonly challenge:
    | z.output<typeof channelChallengeSchema>
    | z.output<typeof deviceBoundSchema>;
  readonly callbackUrl: string;
  readonly purpose: z.output<typeof channelChallengeRequestSchema>["purpose"];
  readonly onRestart: () => void;
  readonly onComplete?: (
    channel: z.output<typeof channelProviderSchema>
  ) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState<ChannelAuthorizationStatus>("pending");
  const [error, setError] = useState<string>();
  const action = useAuthorizationRequest();
  useEffect(() => {
    if (status !== "pending" && status !== "confirmed") return undefined;
    const controller = new AbortController();
    const remaining = Math.max(0, Date.parse(challenge.expiresAt) - Date.now());
    const timer = setTimeout(
      () => {
        controller.abort();
        setStatus("expired");
      },
      Math.min(remaining, 2_147_483_647)
    );
    if (status === "pending") {
      const poll = async () => {
        let failures = 0;
        while (
          !controller.signal.aborted &&
          Date.now() < Date.parse(challenge.expiresAt)
        ) {
          let delay = channelAuthorizationPollIntervalMs;
          try {
            const result = await checkChannelAuthorization(
              challenge.id,
              controller.signal
            );
            controller.signal.throwIfAborted();
            failures = 0;
            setError(undefined);
            if (result.status !== "pending") {
              setStatus(result.status);
              return;
            }
          } catch (cause) {
            controller.signal.throwIfAborted();
            const failure =
              cause instanceof ChannelAuthorizationError
                ? cause
                : channelHttpError(0);
            const next = channelPollFailure(
              failure,
              failures,
              Date.now(),
              Date.parse(challenge.expiresAt)
            );
            setError(
              next.status === "invalid"
                ? `${t(channelFailureMessage(failure, purpose))} ${t("Comece um novo pedido para continuar.")}`
                : t(channelFailureMessage(failure, purpose))
            );
            if (next.status !== "pending") {
              setStatus(next.status);
              return;
            }
            // oxlint-disable-next-line eslint/no-useless-assignment -- A later failed poll reads this counter; successful polls reset it.
            failures = next.failures;
            delay = next.delay;
          }
          await waitForPoll(delay, controller.signal);
        }
        if (!controller.signal.aborted) setStatus("expired");
      };
      void poll().catch(() => {
        if (!controller.signal.aborted)
          setError(t(channelHttpError(0).message));
      });
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [challenge, status, purpose, t]);
  function complete() {
    if (status !== "confirmed") return;
    if (Date.now() >= Date.parse(challenge.expiresAt)) {
      setStatus("expired");
      return;
    }
    action.run(
      (signal) => completeChannelAuthorization(challenge.id, signal),
      () => {
        if (purpose === "link") onRestart();
        if (onComplete) {
          onComplete(challenge.channel);
          return;
        }
        router.replace(safeCallbackUrl(callbackUrl));
        router.refresh();
      }
    );
  }
  return (
    <div className="space-y-3">
      <ChannelStatus
        challenge={challenge}
        purpose={purpose}
        status={status}
        busy={action.busy}
        error={
          action.error ? t(channelFailureMessage(action.error, purpose)) : error
        }
        onContinue={complete}
        onRestart={onRestart}
      />
      {purpose === "link" && action.error?.status === 401 ? (
        <SignInAgain callbackUrl={callbackUrl} />
      ) : null}
    </div>
  );
}
export function useAuthorizationRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChannelAuthorizationError>();
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  function run<A>(
    operation: (signal: AbortSignal) => Promise<A>,
    onSuccess: (value: A) => void
  ) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    void operation(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) onSuccess(value);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof ChannelAuthorizationError
              ? failure
              : channelHttpError(0)
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          active.current = undefined;
          setBusy(false);
        }
      });
  }
  return {
    busy,
    error,
    run,
  };
}
export function SignInAgain({ callbackUrl }: { readonly callbackUrl: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void Promise.allSettled([authClient.signOut()]).then(([outcome]) => {
            const destination = reauthenticationDestination(
              outcome,
              callbackUrl
            );
            if (destination) {
              window.location.assign(destination);
              return undefined;
            }
            setFailed(true);
            setBusy(false);
            return undefined;
          });
        }}
      >
        {busy ? t("Signing out…") : t("Sign in again")}
      </Button>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("Unable to sign out. Check your connection and try again.")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
function waitForPoll(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Polling cancelled", "AbortError")
      );
    }
    signal.addEventListener("abort", abort, {
      once: true,
    });
    if (signal.aborted) abort();
  });
}
