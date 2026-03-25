import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    reporters: ["verbose"],
    // y-websocket bundles its own yjs copy, triggering a harmless
    // duplicate-import warning. Suppress it in test output.
    onConsoleLog(log) {
      if (log.includes("Yjs was already imported")) return false;
    },
  },
});
