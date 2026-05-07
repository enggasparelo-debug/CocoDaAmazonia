// Helpers de data/hora pra inputs `datetime-local` do navegador.
// Inputs HTML5 esperam "YYYY-MM-DDTHH:mm" em horário LOCAL (sem TZ).

// Retorna o instante atual no formato esperado pelo `<input type="datetime-local">`.
export function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// Converte um ISO com timezone (ex.: vindo do Supabase) pra o formato
// que o input datetime-local espera. Aceita null/undefined retornando "now".
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return nowLocalIso();
  const d = new Date(iso);
  if (isNaN(d.getTime())) return nowLocalIso();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
