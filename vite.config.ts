import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Where the built app will be served from. Vite bakes this into every asset URL in
 * `dist/index.html`, so it has to match the deployment path exactly or the page loads
 * without its JavaScript.
 *
 * The default `/` suits a root-hosted deploy (`npm run dev`, GitHub Pages on a custom
 * domain, Netlify). Serving from a subdirectory — a faculty account at
 * `https://www.fi.muni.cz/~xlogin/scheduler/`, say — needs that subpath instead:
 *
 *   APP_BASE=/~xlogin/scheduler/ npm run build
 *
 * Keep the leading and trailing slashes: Vite joins this onto asset names verbatim.
 * See docs/DEPLOY.md.
 */
const base = process.env.APP_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
