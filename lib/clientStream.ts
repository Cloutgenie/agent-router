/** Reads an NDJSON streaming response and invokes onEvent for each parsed line. */
export async function streamNdjson<T>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const parsed = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(parsed.error ?? "Request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as T);
    }
  }
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as T);
  }
}
