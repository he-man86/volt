## ADDED Requirements

### Requirement: Fetched content is staged to git objects without a redundant temp copy

A sync command (`init`, `pull`) SHALL write each fetched content to the git object database directly from
memory/stream, and SHALL NOT first write a throwaway per-file temp copy to disk. Content SHALL reach disk at most
twice — once as a git object, once as the working-tree file — never a third time as intermediate staging.

#### Scenario: Init does not stage temp files

- **WHEN** `volt init` seeds an N-item project
- **THEN** N git blob objects and N `src/` files are produced, and NO per-item temporary files are written to a
  temp directory during blob creation

### Requirement: Object staging is byte-identical to the raw content

The object writer SHALL produce git blob SHAs that are a pure function of the raw fetched bytes (no gitattributes
/ CRLF / encoding filters applied), so that the `volt/ide` history and every round-tripped file are
byte-for-byte identical to what the previous temp-staging path produced.

#### Scenario: SHAs are unchanged by the new writer

- **WHEN** the same content set is staged by the new stream writer and by the previous `hash-object --no-filters`
  path
- **THEN** the two produce identical blob SHAs for every item

#### Scenario: Round-trip fidelity holds against a live bridge

- **WHEN** an item is fetched, staged, written to `src/`, and later pushed back through the e2e parity suite
- **THEN** the item's content round-trips byte-for-byte, and the graphical/crud parity tests pass on both
  CODESYS and TwinCAT

### Requirement: The optimization is confined to blob staging

The change SHALL alter only how fetched bytes become git objects. The pipe wire, the bridges, the `push`/`status`
/`build`/`show`/`merge` commands, and the git-native `volt/ide` model (fetch → compose tree → commit → merge)
SHALL be unchanged; `pull`'s `volt/ide` tree SHALL remain the synthetic composition of changed items plus
unchanged entries from `parentIde` plus scaffold entries from `HEAD`, not the working tree.

#### Scenario: Pull still composes the synthetic ide tree

- **WHEN** `volt pull` stages only the changed items
- **THEN** the resulting `volt/ide` tree still contains the unchanged items (from `parentIde`) and scaffold (from
  `HEAD`), and the subsequent `git merge` behavior is unchanged

#### Scenario: Push is unaffected

- **WHEN** `volt push` sends local edits to the IDE
- **THEN** it reads content from existing git objects (not the working tree) exactly as before, with no blob
  staging involved
