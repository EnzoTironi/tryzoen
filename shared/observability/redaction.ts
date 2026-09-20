import { jsonString, isValid } from "@shared/validation";
import { z } from "zod";

const protectedKey =
  /authorization|cookie|password|secret|credential|api.?key|totp|otp_secret|(?:access|refresh|id|session|continuation)[_-]?token|device.?code|user.?code/i;

function redactDiagnosticText(text: string) {
  return text
    .replace(
      /("(?:authorization|cookie|password|secret|credential|api.?key|totp|otp_secret|(?:access|refresh|id|session|continuation)[_-]?token|device.?code|user.?code)"\s*:\s*")[^"]*/gi,
      "$1[redacted]"
    )
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[redacted token]")
    .replace(
      /\b(?:sk-|xai-|ghp_|gho_|GOCSPX-)[A-Za-z0-9_-]{12,}\b/g,
      "[redacted key]"
    )
    .replace(
      /((?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)\s*[=:]\s*)[^\s,;"<>]+/gi,
      "$1[redacted]"
    )
    .replace(
      /([?&](?:token|code|key|state|start|secret)=)[^&\s"'<>]+/gi,
      "$1[redacted]"
    )
    .replace(/data:[^;,]+;base64,[A-Za-z0-9+/=]+/g, "[binary attachment]");
}

/** Keep diagnostic content useful, while never serializing credential fields or binary blobs. */
export function parseDiagnostic(serialized: string): z.core.util.JSONType {
  const value = jsonString(z.json()).parse(serialized);
  const encoded = JSON.stringify(value, (key, item: z.core.util.JSONType) => {
    if (protectedKey.test(key)) return "[redacted]";
    if (isValid(z.string(), item))
      return redactDiagnosticText(item).slice(0, 64_000);
    return item;
  });
  if (!encoded) return null;
  const bytes = new TextEncoder().encode(encoded).length;
  if (bytes > 1_000_000) return { truncated: true, bytes };
  return jsonString(z.json()).parse(encoded);
}
