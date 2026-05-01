import type { Sandbox } from 'e2b';

type SessionState = {
  sandbox: Sandbox;
  expoUrl: string;
  hasRunOnce: boolean;
};

const g = globalThis as unknown as { __vibeSessions?: Map<string, SessionState> };
const sessions: Map<string, SessionState> =
  g.__vibeSessions ?? (g.__vibeSessions = new Map());

export async function DELETE(_request: Request, { id }: { id: string }) {
  const state = sessions.get(id);
  if (!state) {
    console.log(`[chat ${id}] delete requested but no sandbox tracked`);
    return new Response(null, { status: 204 });
  }
  sessions.delete(id);

  console.log(`[chat ${id}] killing sandbox ${state.sandbox.sandboxId}`);
  try {
    await state.sandbox.kill();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[chat ${id}] sandbox kill failed: ${message}`);
  }
  return new Response(null, { status: 204 });
}
