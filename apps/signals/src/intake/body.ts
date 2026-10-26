/**
 * Reads at most `maxBytes` of a request body, stopping as soon as the stream goes past it.
 * Content-Length is not trusted: a chunked body or a false length is cut off the same way.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  if (body) {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  }
  return bytes.slice(0, length);
}
