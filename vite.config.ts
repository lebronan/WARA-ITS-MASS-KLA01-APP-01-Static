import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Base path set for GitHub Pages repository
  base: "/WARA-ITS-MASS-KLA01-APP-01-Static/",
  plugins: [react()]
});
