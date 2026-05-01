import { fetch } from 'expo/fetch';

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

export type BuildEvent =
  | {
      type: 'meta';
      sessionId: string;
      sandboxId: string;
      expoUrl: string;
    }
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      status: ToolStatus;
      title?: string;
      error?: string;
    }
  | { type: 'file'; id: string; filename?: string; url?: string }
  | { type: 'done'; exitCode: number }
  | { type: 'error'; message: string };

export async function streamBuild(opts: {
  prompt: string;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent: (event: BuildEvent) => void;
}): Promise<void> {
  const res = await fetch('/api/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: opts.prompt, sessionId: opts.sessionId }),
    signal: opts.signal,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // not JSON
    }
    opts.onEvent({ type: 'error', message });
    return;
  }

  if (!res.body) {
    opts.onEvent({ type: 'error', message: 'No response body from server' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        opts.onEvent(JSON.parse(line) as BuildEvent);
      } catch {
        // ignore malformed line
      }
    }
  }

  if (buffer.trim()) {
    try {
      opts.onEvent(JSON.parse(buffer.trim()) as BuildEvent);
    } catch {
      // ignore
    }
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}
