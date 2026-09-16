import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  worker: { format: 'es' },
  build: { target: 'es2020' },
})
