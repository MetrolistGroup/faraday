export async function fetchTextLimited(
  url: string,
  options: RequestInit,
  maxBytes: number,
): Promise<string> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);
  if (!response.body) throw new Error("fetch failed: response had no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
