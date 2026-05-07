// Helpers de UI compartilhados.

/**
 * Extrai uma mensagem legível de um valor desconhecido em catch(e: unknown).
 * Substitui o padrão repetido `e.message ?? String(e)` que exigia
 * `catch(e: any)`.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

export type ToastApi = {
  success: (m: string) => void;
  error: (m: string) => void;
};

export type ToastMessages = {
  /** Mensagem de sucesso. Pode ser string ou função do resultado. */
  success: string | ((result: unknown) => string);
  /** Prefixo da mensagem de erro. Default: "Erro". */
  failure?: string;
};

/**
 * Roda uma função async, mostrando toast de sucesso ou erro.
 *
 * Substitui o padrão repetido:
 *
 *     try {
 *       await op();
 *       toast.success("Salvo");
 *     } catch (e: any) {
 *       toast.error(e.message ?? String(e));
 *     }
 *
 * Retorna o resultado da função, ou `null` se houve erro
 * (caller pode checar `result !== null` pra decidir continuar).
 */
export async function withToast<T>(
  toast: ToastApi,
  fn: () => Promise<T>,
  msg: ToastMessages
): Promise<T | null> {
  try {
    const result = await fn();
    const successMsg =
      typeof msg.success === "function" ? msg.success(result) : msg.success;
    toast.success(successMsg);
    return result;
  } catch (e: unknown) {
    const prefix = msg.failure ?? "Erro";
    const detail = e instanceof Error ? e.message : String(e);
    toast.error(`${prefix}: ${detail}`);
    return null;
  }
}

/**
 * Rejeita se a resposta do Supabase tem `error`. Útil pra encaixar
 * em `withToast(() => assertOk(supabase.from(...).insert(...)))`.
 */
export async function assertOk<T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
