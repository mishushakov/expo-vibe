import { Template, defaultBuildLogger } from 'e2b';
import { template } from './template';

// Build with: npx tsx e2b/build.ts
// After a successful build, set TEMPLATE = 'expo-vibe' in
// app/api/build+api.ts so Sandbox.create() picks up this image.
await Template.build(template, 'expo-vibe', {
  cpuCount: 4,
  memoryMB: 8192,
  onBuildLogs: defaultBuildLogger(),
});
