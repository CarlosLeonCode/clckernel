import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://clckernel.carlosleoncode.com',
  base: '/',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    // three.js is one lazy chunk (~130 kB gzip) loaded only for the hero figure.
    build: { chunkSizeWarningLimit: 600 },
  },
});
