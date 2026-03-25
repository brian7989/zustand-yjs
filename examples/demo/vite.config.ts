import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/zustand-yjs/",
  resolve: {
    dedupe: ["yjs", "react", "react-dom"],
  },
});
