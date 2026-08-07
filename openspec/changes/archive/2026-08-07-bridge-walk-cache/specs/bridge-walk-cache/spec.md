## ADDED Requirements

### Requirement: A walk cache is gated on a proven comprehensive change signal

The bridge SHALL NOT serve a cached item-version map for `/refs` or `/fetch` unless it can first confirm freshness cheaply against an IDE change signal that is PROVEN to cover every mutation path. Absent such proof, `/refs` and `/fetch` SHALL always read the live project (slow-but-correct).

#### Scenario: No cache without a confirmed-fresh signal

- **WHEN** the bridge cannot cheaply confirm the project is unchanged via a comprehensive signal
- **THEN** it re-walks and re-hashes the live items rather than returning a cached map

#### Scenario: A cache never masks an incoming change

- **WHEN** the IDE changed by any means (edit, undo, programmatic, library update, external load)
- **THEN** the next `/refs` or `/fetch` reflects that change — a cache is invalid if it can miss any mutation
