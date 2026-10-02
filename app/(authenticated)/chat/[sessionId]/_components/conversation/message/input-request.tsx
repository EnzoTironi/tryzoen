"use client";

import { useI18n } from "@zoen/companion-ui/i18n";
import { useInputResponse } from "@zoen/companion-ui/input-response";
import { approvalMessageSchema } from "@agent/lib/approval-message";
import type { EveDynamicToolPart, EveMessageInputRequest } from "eve/react";
import {
  Question,
  QuestionActions,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  type QuestionResponse,
  QuestionSubmit,
} from "@web/components/ai-elements/question";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import type { InputResponse } from "eve/client";
import type { RespondToAgentInput } from "./types";

export function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse: savedResponse,
  waiting,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly waiting: boolean;
  readonly inputResponse?: InputResponse;
  readonly onInputResponses: RespondToAgentInput;
}) {
  const { t } = useI18n();
  const submission = useInputResponse(
    canRespond && waiting && !savedResponse,
    onInputResponses
  );
  const inputResponse = savedResponse ?? submission.response;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId
  );
  const hasOptions = (inputRequest.options?.length ?? 0) > 0;
  const acceptsFreeform = inputRequest.allowFreeform === true || !hasOptions;

  const submitResponse = ({ selectedValues, text }: QuestionResponse) =>
    submission.submit({
      optionId: selectedValues[0],
      requestId: inputRequest.requestId,
      text,
    });

  return (
    <Question
      key={inputRequest.requestId}
      defaultValue={{
        selectedValues: inputResponse?.optionId ? [inputResponse.optionId] : [],
        text: inputResponse?.text ?? "",
      }}
      disabled={
        !canRespond ||
        !waiting ||
        submission.pending ||
        inputResponse !== undefined
      }
      onSubmit={submitResponse}
    >
      <QuestionPrompt>{inputRequest.prompt}</QuestionPrompt>
      {hasOptions ? (
        <QuestionOptions
          className="flex-col items-stretch"
          aria-label={inputRequest.prompt}
        >
          {inputRequest.options?.map((option) => (
            <QuestionOption
              className="justify-start text-left"
              key={option.id}
              value={option.id}
            >
              <span>
                <span className="block">{option.label}</span>
                {option.description ? (
                  <span className="block type-caption opacity-70">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </QuestionOption>
          ))}
        </QuestionOptions>
      ) : null}
      {acceptsFreeform ? (
        <QuestionInput
          aria-label={t("Answer")}
          placeholder={t("Type your answer…")}
        />
      ) : null}
      {inputResponse ? (
        <QuestionDescription>
          {t("Responded:")}{" "}
          {selectedOption?.label ??
            inputResponse.text ??
            inputResponse.optionId}
        </QuestionDescription>
      ) : !waiting ? (
        <QuestionDescription>{t("Request closed")}</QuestionDescription>
      ) : (
        <QuestionActions>
          <QuestionSubmit>{t("Answer")}</QuestionSubmit>
        </QuestionActions>
      )}
      {submission.failed && (
        <QuestionDescription role="alert">
          {t("Your answer wasn’t accepted. Please try again.")}
        </QuestionDescription>
      )}
    </Question>
  );
}

export function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveDynamicToolPart;
}) {
  const { t } = useI18n();
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  const submission = useInputResponse(
    canRespond &&
      part.state === "approval-requested" &&
      !part.toolMetadata?.eve?.inputResponse,
    onInputResponses
  );
  if (!inputRequest) return null;

  const inputResponse =
    part.toolMetadata.eve.inputResponse ?? submission.response;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId
  );
  const approvalMessage = approvalMessageSchema.safeParse(
    inputRequest.kind === "tool-approval" &&
      typeof part.input === "object" &&
      part.input !== null &&
      "approvalMessage" in part.input
      ? part.input.approvalMessage
      : undefined
  );

  return (
    <Alert variant="warning">
      <AlertTitle className="whitespace-pre-wrap">
        {approvalMessage.success ? approvalMessage.data : inputRequest.prompt}
      </AlertTitle>
      <AlertDescription>
        {inputResponse ? (
          <p>
            {t("Responded:")}{" "}
            {selectedOption?.label ??
              inputResponse.text ??
              inputResponse.optionId}
          </p>
        ) : part.state !== "approval-requested" ? (
          <p>{t("Request closed")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {inputRequest.options?.map((option) => (
              <Button
                disabled={!canRespond || submission.pending}
                key={option.id}
                onClick={() => {
                  void submission.submit({
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  });
                }}
                size="sm"
                type="button"
                variant={option.style === "danger" ? "destructive" : "default"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
        {submission.failed && (
          <p role="alert">
            {t("Your answer wasn’t accepted. Please try again.")}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
