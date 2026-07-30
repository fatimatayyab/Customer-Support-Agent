import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: "src/main.tsx",
      name: "CSAWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    // Everything (including CSS) bundles into the single IIFE file below -
    // a host page embeds this with one <script> tag, so there's no
    // second asset to also remember to include.
    cssCodeSplit: false,
  },
});
