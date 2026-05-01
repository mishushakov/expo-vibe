import { Template, waitForPort } from 'e2b';

// Where the generated Expo app lives inside the sandbox. OpenCode runs
// from this dir so its file edits land in the project the Expo dev
// server is watching.
export const APP_DIR = '/home/user/app';

// OpenCode HTTP server. The API server in app/api/build+api.ts reaches
// it via https://<sandbox.getHost(OPENCODE_PORT)>.
export const OPENCODE_PORT = 4096;

// Expo Metro / dev server. The client preview loads it via
// https://<sandbox.getHost(EXPO_PORT)>.
export const EXPO_PORT = 8081;
export const EXPO_LOG_PATH = '/tmp/expo-vibe/expo.log';

// fromTemplate('opencode') gives us the OpenCode CLI pre-installed. We
// scaffold the Expo app at build time so fresh sandboxes boot fast, and
// auto-start ONLY the Expo dev server here. OpenCode is started by the
// API server (app/api/build+api.ts) via sandbox.commands.run so we can
// pass per-request envs (OPENAI_API_KEY) — Sandbox.create({ envs })
// does not propagate to the template's setStartCmd process.
//
// AGENTS.md at the workspace root supplies project context to OpenCode;
// it's preferred over the per-prompt `system` field, which replaces the
// built-in agent prompt (incl. tool-calling instructions) and hangs.
export const template = Template()
  .fromBaseImage()
  .npmInstall('opencode-ai', { g: true })
  .setWorkdir('/home/user')
  .runCmd(`npx create-expo-app@latest ${APP_DIR} --yes`)
  .copy('AGENTS.md', `${APP_DIR}/AGENTS.md`)
  .setWorkdir(APP_DIR)
  .aptInstall(['gh'])
  .setStartCmd(
    `bash -lc 'mkdir -p /tmp/expo-vibe && : > ${EXPO_LOG_PATH} && cd ${APP_DIR} && npx expo start --port ${EXPO_PORT} 2>&1 | tee -a ${EXPO_LOG_PATH}'`,
    waitForPort(EXPO_PORT)
  );
