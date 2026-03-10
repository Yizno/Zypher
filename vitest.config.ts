import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "dist-electron/**", "node_modules/**"]
  }
});
