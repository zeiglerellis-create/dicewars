import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
// GitHub project Pages URL: https://<user>.github.io/<repo>/
export default defineConfig({
  base: '/dicewars/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
  },
})
