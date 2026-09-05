import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Database-backed suites truncate shared tables between cases. Run files in
    // sequence; concurrency behavior is exercised explicitly inside integration tests.
    fileParallelism: false,
  },
});
