import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['mcp-server/tests/**/*.test.ts'],
  },
})