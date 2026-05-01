# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Configure environment variables

   ```bash
   cp .env.example .env
   # then fill in E2B_API_KEY and ANTHROPIC_API_KEY
   ```

   - `E2B_API_KEY` — get one at https://e2b.dev
   - `OPENAI_API_KEY` — used by `opencode` running inside the sandbox
   - `OPENCODE_MODEL` — optional, defaults to `openai/gpt-5.5`

   Keys are server-side only (consumed by `app/api/build+api.ts`); do **not** prefix them with `EXPO_PUBLIC_`.

3. Start the app

   ```bash
   npx expo start
   ```

   The chat UI calls `POST /api/build`, which spins up an E2B `opencode` sandbox, starts `opencode serve` on port 4096, and talks to it through the [`@opencode-ai/sdk`](https://opencode.ai/docs/sdk/) over the sandbox's public host (`Sandbox.getHost(4096)`). Each opencode SSE event (text part, tool call, etc.) is forwarded as NDJSON and rendered as a discrete chat message. Subsequent prompts in the same chat reuse the sandbox + opencode session.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
