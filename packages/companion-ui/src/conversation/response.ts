import { useRef, useState } from "react";
import type { InputResponse } from "eve/client";

/** Mount once per native requestId, so an accepted answer cannot be sent twice. */
export function useInputResponse(
  enabled: boolean,
  onRespond: (responses: readonly InputResponse[]) => void | Promise<void>
) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [response, setResponse] = useState<InputResponse>();
  const submitted = useRef(false);

  async function submit(next: InputResponse) {
    if (!enabled || submitted.current) return;
    submitted.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onRespond([next]);
      setResponse(next);
    } catch {
      submitted.current = false;
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return { pending, failed, response, submit };
}
