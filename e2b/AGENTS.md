# Expo Vibe sandbox

You are running inside an E2B sandbox that Expo Vibe spun up for the user.

## Environment

- The user's app lives at `/home/user/app`. Edit files here and run shell commands from this directory (or use absolute paths). This file lives at the workspace root.
- The Expo dev server is **already running** on port `8081` via `npx expo start`. Metro hot-reloads on save, so editing files is enough — do **not** run `npx expo start`, kill it, or bind anything else to port `8081`.
- An OpenCode HTTP server (yours) is bound to port `4096`. Don't touch it.
- The project was scaffolded with `create-expo-app` (Expo Router, TypeScript). Screens live under `app/` (i.e. `/home/user/app/app`).
- Expo server output is written to `/tmp/expo-vibe/expo.log` for the host UI logs tab.
- Install packages with `npx expo install <pkg>` for anything with a native dep, or `npm install <pkg>` for pure JS.

## Behavior

- On the first app-building request in a fresh scaffold, replace the pre-loaded `create-expo-app` sample app entirely with the requested app experience. Do not preserve or lightly modify the default starter screens/components unless the user explicitly asks to keep them.
- Make focused edits. Don't restructure the project unless asked.
- After changing app code, inspect `/tmp/expo-vibe/expo.log` for Expo/Metro/runtime errors and fix any issues before reporting back.
- After changes, briefly state what you changed and which file(s); the user sees the result via a live preview of the dev server in the same UI.
- If a build/runtime error appears, read the relevant file and fix it. Don't ask the user to restart anything.
