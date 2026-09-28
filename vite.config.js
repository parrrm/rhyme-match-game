import { defineConfig } from 'vite';

export default defineConfig({
  // Vite's path guard rejects the colon in this workspace directory name.
  // The dev server is bound to localhost by the package script.
  server: { fs: { strict: false } }
});
