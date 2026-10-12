/**
 * the helpers `rules.ts`'s parts share: the fixture builders and the data they are built from (openspec
 * lsp-same-standard 4.4).
 */

export interface UnitTest {
  /** Path relative to the package. */
  file: string
  /** The test's title, exactly. */
  title: string
}

export interface Rule {
  id: string
  /** The design's area: 2 grammar, 3 names, 4 types. */
  area: 2 | 3 | 4
  /** The design's section (`2.1` Lexer … `4.7` Derived types). */
  section: string
  rule: string
  /** Its file in the target structure. */
  home: string
  gap: boolean
  fixtures: readonly string[]
  /** Named unit tests — the Volt workspace format's rules (FMT), which no vendor records. */
  tests?: readonly UnitTest[]
  /** The design's Fixtures cell, verbatim. */
  design: string
  /** What task 0.5's re-check changed about this row, and why. */
  recheck?: string
}
