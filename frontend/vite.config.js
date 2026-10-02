import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend runs on 5001 (port 5000 is used by AirPlay Receiver on macOS).
const backend = process.env.BACKEND_URL || "http://localhost:5001";

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite rejects requests whose Host header it doesn't know. Allow the public
    // tunnel domains used for remote demos (a leading dot allows subdomains).
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev"],
    proxy: {
      "/api": { target: backend, changeOrigin: true },
    },
  },
});
