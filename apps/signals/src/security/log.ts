type Field = string | number | boolean | null;

/**
 * One structured JSON log line. Callers pass fixed codes and validated ids only: never a
 * header value, a request or upstream body, or an error message, any of which can hold a
 * secret.
 */
export function logEvent(
  level: 'log' | 'warn' | 'error',
  message: string,
  fields: Readonly<Record<string, Field>> = {}
): void {
  const line = JSON.stringify({ message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
