import { defineConfig } from 'vite';

export default defineConfig({
    base: '/radiant-photon/', // Important for GitHub Pages repo name
    build: {
        outDir: 'dist'
    }
});
