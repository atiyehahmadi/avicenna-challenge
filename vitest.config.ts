/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Test configuration lives here rather than in vite.config.ts so that the base
 * config stays untouched, and merging it means the tests run through the same
 * plugins and transforms as the app.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      // No globals: describe/it/expect are imported explicitly, which keeps
      // tsconfig free of a vitest/globals types entry.
      globals: false,
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
