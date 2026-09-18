import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "rewards/index": "src/rewards/index.ts", cli: "src/cli.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
