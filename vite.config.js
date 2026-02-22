import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    // Relative Asset-Pfade machen den Build direkt GitHub-Pages-tauglich.
    base: "./",
    plugins: [react()]
});
