import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  build: {
    target: 'es2019',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
  },
})
