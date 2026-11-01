/** Server-Sent Events parser over a byte stream (works with expo/fetch, browsers and Node). */
export type SseMessage = { event: string; data: string; id: string | null };

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain();
    }
    buffer += decoder.decode();
    buffer += '\n\n';
    yield* drain();
  } finally {
    reader.releaseLock();
  }

  function* drain(): Generator<SseMessage> {
    buffer = buffer.replace(/\r\n?/g, '\n');
    let sep = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const msg = parseBlock(block);
      if (msg) yield msg;
      sep = buffer.indexOf('\n\n');
    }
  }
}

export function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
  }
  if (!data.length) return null;
  return { event, data: data.join('\n'), id };
}

/** Parses JSON payloads, skipping `[DONE]` sentinels and unknown non-JSON frames. */
export async function* sseJson<T = Record<string, unknown>>(body: ReadableStream<Uint8Array>): AsyncGenerator<T & { _event: string }> {
  for await (const m of parseSse(body)) {
    if (m.data === '[DONE]') continue;
    try {
      yield { ...(JSON.parse(m.data) as T), _event: m.event };
    } catch {
      continue;
    }
  }
}
