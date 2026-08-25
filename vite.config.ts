import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true - слушать и IPv4 (127.0.0.1), и IPv6. по умолчанию vite садится
  // только на ::1, а окружение блокирует IPv6-loopback → ECONNREFUSED на 127.0.0.1
  server: { host: true },
});
