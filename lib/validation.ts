export class RequestValidationError extends Error {}

export async function readJsonObject(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new RequestValidationError('Request body is too large.');
  let raw = '';
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new RequestValidationError('Request body is too large.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new RequestValidationError('Request body must be valid UTF-8 JSON.');
    }
  }
  if (!raw.trim()) throw new RequestValidationError('Request body is required.');
  if (new TextEncoder().encode(raw).byteLength > maxBytes)
    throw new RequestValidationError('Request body is too large.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RequestValidationError('Request body must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestValidationError('Request body must be a JSON object.');
  return value as Record<string, unknown>;
}

export function validCalendarDate(value: string, today: string, allowPast = true): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d)
    return false;
  const max = new Date(today + 'T12:00:00Z');
  max.setUTCFullYear(max.getUTCFullYear() + 5);
  return (
    value >= '2000-01-01' &&
    (allowPast || value >= today) &&
    value <= max.toISOString().slice(0, 10)
  );
}

export function boundedText(value: unknown, max: number, label = 'Text'): string {
  if (typeof value !== 'string') throw new RequestValidationError(`${label} must be text.`);
  const result = value.trim();
  if (result.length > max)
    throw new RequestValidationError(`${label} must be ${max} characters or fewer.`);
  return result;
}
