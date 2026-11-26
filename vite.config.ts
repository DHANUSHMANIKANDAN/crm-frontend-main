import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Keep in sync with backend/src/main/resources/application.yml → server.port
const BACKEND_PORT = 8589;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = env.VITE_API_TARGET || 'local';
  if (apiTarget !== 'local' && apiTarget !== 'dev') {
    throw new Error(`VITE_API_TARGET must be "local" or "dev", received "${apiTarget}".`);
  }

  const apiUrl =
    apiTarget === 'local'
      ? env.VITE_LOCAL_API_URL || `http://localhost:${BACKEND_PORT}`
      : env.VITE_DEV_API_URL;

  if (!apiUrl) {
    throw new Error(`Missing API URL for VITE_API_TARGET="${apiTarget}" in the environment.`);
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(apiUrl);
  } catch {
    throw new Error(`Invalid API URL for VITE_API_TARGET="${apiTarget}": ${apiUrl}`);
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    throw new Error(`API URL must use HTTP or HTTPS: ${apiUrl}`);
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': {
          target: targetUrl.toString(),
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              // Browser Origin is the Vite port; backend Host is another port — strip so
              // OriginCheckFilter does not treat proxied dev traffic as cross-site.
              proxyReq.removeHeader('origin');
              proxyReq.removeHeader('referer');
            });
          },
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
