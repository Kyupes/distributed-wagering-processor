import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ['test/**/*.integration-spec.ts'],
    setupFiles: ['./test/setup-dependency-env.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
