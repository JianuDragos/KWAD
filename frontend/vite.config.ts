import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Backendul (KWAD/AERIS API) rulează pe http://localhost:5271 cu profilul "http".
// Nu are CORS, deci în dev trecem prin proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // AERIS_API permite alt port (de ex. când pe 5271 rulează deja o versiune veche).
      '/api': process.env.AERIS_API ?? 'http://localhost:5271',
    },
  },
  test: {
    environment: 'node',
  },
})
