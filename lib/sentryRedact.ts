// Sentry — redaction de PII e secrets antes do envio.
//
// Aplicado via `beforeSend` em sentry.{client,server,edge}.config.ts.
// Percorre o evento recursivamente e substitui valores de chaves
// sensíveis por "[REDACTED]". Strings longas em base64 (data URLs de
// assinatura) também são truncadas.

const SENSITIVE_KEYS = new Set([
  "signer_document",
  "signer_address",
  "signature_data_url",
  "cpf",
  "rg",
  "senha",
  "password",
  "token",
  "service_role",
  "service_role_key",
  "supabase_service_role_key",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
]);

const REDACTED = "[REDACTED]";
const MAX_STRING_LEN = 2_000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function redactString(s: string): string {
  // Trunca data URLs (signature_data_url tem ~50KB de base64).
  if (s.startsWith("data:") && s.length > 200) return "[REDACTED:data-url]";
  if (s.length > MAX_STRING_LEN) return s.slice(0, MAX_STRING_LEN) + "…";
  return s;
}

export function redactPii<T>(input: T, depth = 0): T {
  if (depth > 8) return input;
  if (typeof input === "string") return redactString(input) as T;
  if (Array.isArray(input)) {
    return input.map((v) => redactPii(v, depth + 1)) as T;
  }
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = redactPii(v, depth + 1);
      }
    }
    return out as T;
  }
  return input;
}

// Sentry event tem shape complexo; aceitamos `unknown` e devolvemos
// o mesmo tipo. Cobre extra, contexts, request.data, breadcrumbs,
// user (sem mexer em fields públicos como user.id/email se eles não
// estão na blocklist).
export function sentryBeforeSend<T>(event: T): T {
  return redactPii(event);
}
