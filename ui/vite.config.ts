import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ["localhost", "127.0.0.1", "0.0.0.0", "ui.coredrain.orb.local"],
  },
  // Allow configuring API URL via environment variable for production
  define: {
    // Default to localhost for development
    "import.meta.env.VITE_API_URL": JSON.stringify(
      process.env.VITE_API_URL || "http://localhost:9465"
    ),
  },
});
