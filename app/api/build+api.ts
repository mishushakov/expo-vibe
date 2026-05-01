import { Sandbox } from 'e2b';

type SessionState = {
  sandbox: Sandbox;
  expoUrl: string;
  // True after the first successful `opencode run` so subsequent prompts
  // pass `--continue` to pick up the same conversation.
  hasRunOnce: boolean;
};

// Survive hot reload in dev by stashing on globalThis.
// NOTE: in-memory only — single Node process. Production needs a real store.
const g = globalThis as unknown as { __vibeSessions?: Map<string, SessionState> };
const sessions: Map<string, SessionState> =
  g.__vibeSessions ?? (g.__vibeSessions = new Map());

const TEMPLATE = 'expo-vibe';
const EXPO_PORT = 8081;
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

async function createSessionState(opts: {
  e2bApiKey: string;
  openaiApiKey: string;
  log: (msg: string) => void;
}): Promise<SessionState> {
  const { log } = opts;

  log(`creating sandbox (template=${TEMPLATE})`);
  const sandbox = await Sandbox.create(TEMPLATE, {
    apiKey: opts.e2bApiKey,
    envs: { OPENAI_API_KEY: opts.openaiApiKey },
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });
  log(`sandbox ready: ${sandbox.sandboxId}`);

  const expoUrl = `https://${sandbox.getHost(EXPO_PORT)}`;
  log(`expo dev server URL: ${expoUrl}`);

  return { sandbox, expoUrl, hasRunOnce: false };
}

export async function POST(request: Request) {
  let body: { sessionId?: string; prompt?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: 'Missing prompt' }, { status: 400 });

  const e2bApiKey = process.env.E2B_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const modelSpec = process.env.OPENCODE_MODEL ?? 'openai/gpt-5';
  if (!e2bApiKey) {
    return Response.json({ error: 'E2B_API_KEY not set on server' }, { status: 500 });
  }
  if (!openaiApiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not set on server' }, { status: 500 });
  }

  const chatId = body.sessionId ?? crypto.randomUUID();
  const log = (msg: string) => console.log(`[chat ${chatId}] ${msg}`);

  // NDJSON stream of cleaned-up build events. We parse opencode's `--format
  // json` output server-side and forward only what the UI cares about:
  // assistant text, tool-call lifecycle, reasoning, attached files. The
  // noisy stuff (per-token deltas, step-start/finish, snapshots, patches,
  // session pings) is dropped here.
  //
  // Forwarded shapes:
  //   { type: 'meta',      sessionId, sandboxId, expoUrl }
  //   { type: 'text',      id, text }
  //   { type: 'reasoning', id, text }
  //   { type: 'tool',      id, name, status, title?, error? }
  //   { type: 'file',      id, filename?, url? }
  //   { type: 'done',      exitCode }
  //   { type: 'error',     message }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          closed = true;
        }
      };

      // opencode emits one JSON event per stdout line, but `onStdout` chunks
      // may split mid-line — buffer until newline. Schema (see opencode
      // packages/opencode/src/cli/cmd/run.ts):
      //   { type: "text"|"tool_use"|"reasoning"|"step_start"|"step_finish"|"error",
      //     timestamp, sessionID,
      //     part?: <Part>,    // for text/tool_use/reasoning/step_*
      //     error?: <Error>,  // for error
      //   }
      // text fires only when the text part finishes (part.time.end set).
      // tool_use fires only on completed/error status.
      // reasoning needs --thinking on the CLI; we don't pass it.

      // Build a short, single-line human label per tool. opencode's `state.title`
      // is empty for some tools (glob/grep) and a multi-line success blob for
      // others (apply_patch), so we synthesize from tool + input.
      const toolLabel = (
        tool: string,
        input: Record<string, unknown> | undefined,
        title: string | undefined,
      ): string => {
        const trim = (s: unknown, n = 80) => {
          const str = String(s ?? '').replace(/\s+/g, ' ').trim();
          return str.length > n ? str.slice(0, n - 1) + '…' : str;
        };

        const firstTitleLine = title
          ?.split('\n')
          .map((line) => line.trim())
          .find(Boolean);

        if (firstTitleLine) return firstTitleLine;

        const hint =
          input?.filePath ??
          input?.pattern ??
          input?.command ??
          input?.url ??
          input?.query ??
          input?.description ??
          input?.id;

        return hint ? `${tool} ${trim(hint)}` : tool;
      };

      let stdoutBuffer = '';
      const handleStdoutLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        const ev = event as {
          type?: string;
          part?: {
            id?: string;
            type?: string;
            text?: string;
            synthetic?: boolean;
            ignored?: boolean;
            tool?: string;
            filename?: string;
            url?: string;
            state?: {
              status?: string;
              title?: string;
              error?: string;
            };
          };
          error?: unknown;
        };

        switch (ev.type) {
          case 'text': {
            const part = ev.part;
            if (!part?.id) return;
            if (part.synthetic || part.ignored) return;
            const text = (part.text ?? '').trim();
            if (!text) return;
            send({ type: 'text', id: part.id, text });
            return;
          }
          case 'tool_use': {
            const part = ev.part as {
              id?: string;
              tool?: string;
              state?: {
                status?: string;
                title?: string;
                error?: string;
                input?: Record<string, unknown>;
              };
            };
            if (!part?.id) return;
            const tool = part.tool ?? 'tool';
            send({
              type: 'tool',
              id: part.id,
              name: tool,
              status: part.state?.status ?? 'completed',
              title: toolLabel(tool, part.state?.input, part.state?.title),
              error: part.state?.error,
            });
            return;
          }
          case 'reasoning': {
            const part = ev.part;
            if (!part?.id) return;
            const text = (part.text ?? '').trim();
            if (!text) return;
            send({ type: 'reasoning', id: part.id, text });
            return;
          }
          case 'error': {
            send({ type: 'error', message: JSON.stringify(ev.error) });
            return;
          }
          // step_start / step_finish — internal step markers, drop.
          default:
            return;
        }
      };

      try {
        let state = sessions.get(chatId);
        if (!state) {
          state = await createSessionState({ e2bApiKey, openaiApiKey, log });
          sessions.set(chatId, state);
        } else {
          await state.sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
          log(`reusing sandbox ${state.sandbox.sandboxId}`);
        }

        send({
          type: 'meta',
          sessionId: chatId,
          sandboxId: state.sandbox.sandboxId,
          expoUrl: state.expoUrl,
        });

        const promptPath = `/tmp/vibe-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
        await state.sandbox.files.write(promptPath, prompt);

        const flags = [
          `--model ${modelSpec}`,
          state.hasRunOnce ? '--continue' : '',
          '--format json',
        ]
          .filter(Boolean)
          .join(' ');
        const cmd = `opencode run ${flags} "$(cat ${promptPath})"`;
        log(`running: opencode run ${flags} (prompt at ${promptPath})`);

        const result = await state.sandbox.commands.run(cmd, {
          cwd: '/home/user/app',
          envs: { OPENAI_API_KEY: openaiApiKey },
          timeoutMs: RUN_TIMEOUT_MS,
          onStdout: (data: string) => {
            process.stdout.write(`[opencode-run ${state.sandbox.sandboxId}] ${data}`);
            stdoutBuffer += data;
            let nl: number;
            while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
              const line = stdoutBuffer.slice(0, nl);
              stdoutBuffer = stdoutBuffer.slice(nl + 1);
              handleStdoutLine(line);
            }
          },
          onStderr: (data: string) => {
            process.stderr.write(`[opencode-run ${state.sandbox.sandboxId}] ${data}`);
          },
        });

        if (stdoutBuffer.trim()) handleStdoutLine(stdoutBuffer);

        log(`opencode run exited with code ${result.exitCode}`);
        if (result.exitCode === 0) state.hasRunOnce = true;
        send({ type: 'done', exitCode: result.exitCode });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`error: ${message}`);
        send({ type: 'error', message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Session-Id': chatId,
    },
  });
}
