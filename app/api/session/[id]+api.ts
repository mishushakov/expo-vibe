import type { EntryInfo, Sandbox } from 'e2b';

type SessionState = {
  sandbox: Sandbox;
  expoUrl: string;
  hasRunOnce: boolean;
};

const g = globalThis as unknown as { __vibeSessions?: Map<string, SessionState> };
const sessions: Map<string, SessionState> =
  g.__vibeSessions ?? (g.__vibeSessions = new Map());

const EXPLORER_ROOT = '/home/user/app';
const EXPO_LOG_PATH = '/tmp/expo-vibe/expo.log';
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const DEFAULT_LOG_LINES = 300;
const MAX_LOG_LINES = 1000;

const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.env',
  '.example',
  '.gitignore',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.log',
  '.md',
  '.mjs',
  '.plist',
  '.prettierrc',
  '.properties',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_FILE_NAMES = new Set(['Dockerfile', 'LICENSE', 'Makefile', 'README']);

function normalizeExplorerPath(value: string | null): string {
  const raw = value?.trim() || EXPLORER_ROOT;
  const absolute = raw.startsWith('/') ? raw : `${EXPLORER_ROOT}/${raw}`;
  const parts: string[] = [];

  for (const segment of absolute.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }

  const normalized = `/${parts.join('/')}`;
  if (normalized === EXPLORER_ROOT || normalized.startsWith(`${EXPLORER_ROOT}/`)) {
    return normalized;
  }

  return EXPLORER_ROOT;
}

function serializeEntry(entry: EntryInfo) {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.size,
    modifiedTime: entry.modifiedTime?.toISOString(),
  };
}

function isTextFileName(name: string): boolean {
  if (TEXT_FILE_NAMES.has(name)) return true;
  const lowerName = name.toLowerCase();
  return [...TEXT_FILE_EXTENSIONS].some((extension) => lowerName.endsWith(extension));
}

function parseLineLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_LINES;
  return Math.min(MAX_LOG_LINES, Math.max(50, Math.floor(parsed)));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

export async function GET(request: Request, { id }: { id: string }) {
  const state = sessions.get(id);
  if (!state) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const currentPath = normalizeExplorerPath(url.searchParams.get('path'));
  const readPath = url.searchParams.get('readPath');
  const logs = url.searchParams.get('logs');

  try {
    await state.sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});

    if (logs === 'expo') {
      const lineLimit = parseLineLimit(url.searchParams.get('lines'));
      const logExists = await state.sandbox.files.exists(EXPO_LOG_PATH).catch(() => false);

      if (!logExists) {
        return Response.json({
          path: EXPO_LOG_PATH,
          logs: '',
          missing: true,
          updatedAt: new Date().toISOString(),
          message:
            'Expo log file is not available in this sandbox. Rebuild the E2B template and start a new chat to capture Expo logs.',
        });
      }

      const logInfo = await state.sandbox.files.getInfo(EXPO_LOG_PATH);
      const result = await state.sandbox.commands.run(`tail -n ${lineLimit} ${EXPO_LOG_PATH}`, {
        timeoutMs: 5000,
      });

      return Response.json({
        path: EXPO_LOG_PATH,
        size: logInfo.size,
        logs: stripAnsi(result.stdout),
        updatedAt: new Date().toISOString(),
      });
    }

    if (readPath) {
      const filePath = normalizeExplorerPath(readPath);
      const info = await state.sandbox.files.getInfo(filePath);

      if (info.type !== 'file') {
        return Response.json({ error: 'Path is not a file' }, { status: 400 });
      }

      if (!isTextFileName(info.name)) {
        return Response.json({ error: 'Only text files can be opened' }, { status: 415 });
      }

      if (info.size > MAX_TEXT_FILE_BYTES) {
        return Response.json(
          { error: `File is too large to preview (${info.size} bytes)` },
          { status: 413 }
        );
      }

      const content = await state.sandbox.files.read(filePath, { format: 'text' });

      return Response.json({
        root: EXPLORER_ROOT,
        ...serializeEntry(info),
        content,
      });
    }

    const info = await state.sandbox.files.getInfo(currentPath);
    if (info.type !== 'dir') {
      return Response.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const entries = await state.sandbox.files.list(currentPath);
    const sortedEntries = entries
      .slice()
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(serializeEntry);

    return Response.json({
      root: EXPLORER_ROOT,
      path: currentPath,
      entries: sortedEntries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

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
