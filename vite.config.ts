import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["maplibre-gl"] },
  server: {
    proxy: {
      "/api/telemetry": "http://127.0.0.1:7071",
      "/api": "http://127.0.0.1:7070",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) return "maps";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("three") || id.includes("@react-three"))
            return "three";
          if (id.includes("react")) return "react";
        },
      },
    },
  },
});
