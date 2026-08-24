import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('mapbox-gl')) {
            return 'vendor-mapbox';
          }
          if (id.includes('leaflet')) {
            return 'vendor-leaflet';
          }
          if (id.includes('@radix-ui')) {
            return 'vendor-radix';
          }
        },
      },
    },
  },
})
