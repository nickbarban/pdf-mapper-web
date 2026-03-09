import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5172,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://backend:5171',
        changeOrigin: true
      }
    }
  }
})
