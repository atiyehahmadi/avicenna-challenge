import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 loopback explicitly. Vite's default `localhost` resolves to
    // ::1 first on this machine, and IPv6 loopback is blocked here (WSAEACCES),
    // so the browser gets ERR_CONNECTION_REFUSED on http://localhost:5173.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
