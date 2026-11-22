import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Capacitor 는 file 기반으로 로드하므로 상대 경로
  base: './',
})
