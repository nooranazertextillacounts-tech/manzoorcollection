import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(), 
      tailwindcss(),
      /* VitePWA removed */
    ],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router'],
      alias: [
        { find: /^firebase\/firestore$/, replacement: path.resolve(__dirname, 'src/lib/customFirestore.ts') },
        { find: '@', replacement: path.resolve(__dirname, '.') }
      ]
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router',
        'react-hot-toast',
        'lucide-react',
        'clsx',
        'date-fns',
        'motion/react',
        'recharts',
        'react-barcode',
        'firebase/app',
        'firebase/auth'
      ]
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
