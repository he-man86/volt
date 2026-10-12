/**
 * The `FailureReport` a test's own `WorkspaceStore` takes (`workspace-store.ts`): a document whose parse or bind throws
 * in a test is a fault there, never a quarantine to look past — rethrown, so the test fails naming it.
 */
export function failLoud(uri: string, error: unknown): never {
  throw new Error(`test: ${uri} could not be analysed`, { cause: error })
}
