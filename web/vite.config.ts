import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Docker the API is another service, so the proxy target has to be the
// service name - "localhost" inside the web container is the web container.
const target = process.env.VITE_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": { target, changeOrigin: true } },
  },
});
