import { mergeConfig, defineConfig } from "vite"
import base from "./vite.config"
export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: "dist-table-perf", rollupOptions: { input: "perf/data-table/index.html" } },
  }),
)
