/** Minimal Workers D1 shim so vitest/tsc can typecheck worker/router + groups. */
declare interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}
