import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

async function runBuild() {
  console.log('🚀 Iniciando build do InstaHub Chrome Extension...');

  // 1. Build Pages (Popup & Dashboard) and Background Worker
  console.log('📦 1/3 Compilando Popup, Dashboard e Background Service Worker...');
  await build({
    root: rootDir,
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          popup: resolve(rootDir, 'popup.html'),
          dashboard: resolve(rootDir, 'dashboard.html'),
          background: resolve(rootDir, 'src/background/index.ts'),
        },
        output: {
          entryFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'background') {
              return 'background.js';
            }
            return 'assets/[name]-[hash].js';
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  });

  // 2. Build Content Script as standalone IIFE
  console.log('🧩 2/3 Compilando Content Script em formato IIFE...');
  await build({
    root: rootDir,
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      lib: {
        entry: resolve(rootDir, 'src/content/index.ts'),
        name: 'InstaHubContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  });

  // 3. Copy content.css and verify public assets
  console.log('🎨 3/3 Copiando content.css e verificando manifest.json...');
  fs.copyFileSync(
    resolve(rootDir, 'src/content/content.css'),
    resolve(rootDir, 'dist/content.css')
  );

  console.log('✨ Build concluído com sucesso em dist/!');
}

runBuild().catch((err) => {
  console.error('❌ Erro no build:', err);
  process.exit(1);
});
