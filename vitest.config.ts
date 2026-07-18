import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // `server-only` throws outside RSC; tests run in plain Node
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // node by default; component tests opt into jsdom via `// @vitest-environment jsdom`
    environment: "node",
  },
});
