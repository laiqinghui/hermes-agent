/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ESRI ships native ESM, but its widgets pull a legacy ESM subtree
  // (@arcgis/core -> @vaadin/grid -> @polymer/polymer, used by the feature-table).
  // Vite 8's Rolldown dep-optimizer mangles that code — e.g. Polymer's valid
  // `static import(id, selector)` method is re-emitted so the browser rejects it
  // with "Unexpected token '('". That makes loadEsri() throw before any layer is
  // added, so the map renders no data. Excluding the whole subtree serves it as
  // native ESM (which the browser parses fine), instead of pre-bundling it.
  optimizeDeps: {
    exclude: [
      '@arcgis/core',
      '@arcgis/map-components',
      '@polymer/polymer',
      '@vaadin/grid',
      '@vaadin/a11y-base',
      '@vaadin/checkbox',
      '@vaadin/component-base',
      '@vaadin/field-base',
      '@vaadin/icon',
      '@vaadin/input-container',
      '@vaadin/lit-renderer',
      '@vaadin/text-field',
      '@vaadin/vaadin-lumo-styles',
      '@vaadin/vaadin-material-styles',
      '@vaadin/vaadin-themable-mixin'
    ]
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
