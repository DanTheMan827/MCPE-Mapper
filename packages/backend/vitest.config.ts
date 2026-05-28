/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@mcpe-mapper/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    globals: true,
  },
});
