# Expo Vibe

Expo Vibe is a web and native Expo app for generating Expo applications through a chat interface. Each chat spins up an [E2B](https://e2b.dev) sandbox from the `expo-vibe` template, asks [OpenCode](https://opencode.ai) to edit the sandboxed Expo project, and shows the generated app in a live preview.

https://github.com/user-attachments/assets/fb20e06b-c17a-428b-a0b4-93a7d088a192

## What It Does

- Chat with an AI coding agent to build or revise an Expo app.
- Keep multiple chat sessions, each backed by its own sandbox and generated app.
- Stream assistant text, tool activity, errors, and completion events into the chat.
- Preview the sandboxed Expo dev server in an iframe on web or a WebView on native.
- Browse generated files under `/home/user/app`.
- Inspect Expo logs from `/tmp/expo-vibe/expo.log` and paste them back into chat for fixes.
- Open the preview externally, reload it, or show an Expo Go QR code.
- Push the generated app to GitHub from inside the sandbox when `GH_TOKEN` is configured.
- Toggle light and dark mode.

## Tech Stack

- [Expo 54](https://expo.dev) with [Expo Router](https://expo.dev/router)
- React 19 and TypeScript
- [E2B](https://e2b.dev) sandboxes for isolated app generation
- [OpenCode](https://opencode.ai) CLI inside each sandbox

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Configure these server-side variables:

```bash
E2B_API_KEY=
OPENAI_API_KEY=
OPENCODE_MODEL=openai/gpt-5
GH_TOKEN=
```

`E2B_API_KEY` and `OPENAI_API_KEY` are required. `OPENCODE_MODEL` is optional; if unset, the API route falls back to `openai/gpt-5-mini`. `GH_TOKEN` is optional and is only needed for the GitHub sync action.

Do not prefix these values with `EXPO_PUBLIC_`; they are consumed by server-side API routes.

For native builds, the client usually infers the local API origin from Expo. If it cannot, set:

```bash
EXPO_PUBLIC_API_ORIGIN=http://<your-dev-server-host>:8081
```

## E2B Template

The API route creates sandboxes from an E2B template named `expo-vibe`. Build or rebuild that template before running the app against real sandboxes:

```bash
npm run build:e2b
```

The template:

- Installs `opencode-ai` globally.
- Scaffolds a fresh Expo app at `/home/user/app`.
- Copies `e2b/AGENTS.md` into the generated app as sandbox instructions.
- Installs the GitHub CLI.
- Starts Expo on port `8081`.
- Captures Expo output in `/tmp/expo-vibe/expo.log`.

## Running Locally

Start Expo:

```bash
npm run web
```

You can also use:

```bash
npm start
npm run ios
npm run android
```

The app exposes these API routes through Expo Router:

- `POST /api/build` starts or continues an OpenCode session in a sandbox and streams NDJSON events.
- `GET /api/session/[id]` lists files, reads text files, or returns Expo logs for a sandbox session.
- `DELETE /api/session/[id]` kills a sandbox and removes its in-memory session state.

Session state is stored in memory on the local Node process, so restarting the dev server drops tracked sessions.

## Project Map

- `app/index.tsx` - main chat, session list, preview, file, and log UI.
- `app/api/build+api.ts` - creates/reuses E2B sandboxes and streams OpenCode events.
- `app/api/session/[id]+api.ts` - sandbox file browser, text file preview, log reader, and cleanup.
- `lib/build-client.ts` - client helpers for build streaming and session APIs.
- `components/sandbox-preview.tsx` - iframe/WebView preview wrapper.
- `components/file-explorer.tsx` - sandbox file browser and text preview.
- `components/expo-logs.tsx` - Expo log viewer with paste-to-chat support.
- `e2b/template.ts` - E2B template definition.
- `e2b/AGENTS.md` - instructions given to OpenCode inside generated apps.

## Available Scripts

```bash
npm start          # expo start
npm run web        # expo start --web
npm run ios        # expo start --ios
npm run android    # expo start --android
npm run build:e2b  # build the E2B sandbox template
npm run lint       # expo lint
```
