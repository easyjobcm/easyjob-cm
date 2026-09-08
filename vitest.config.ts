import path from "node:path";
import { defineConfig } from "vitest/config";

// Setup minimal : uniquement les fonctions pures de lib/utils (node, sans DOM).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
