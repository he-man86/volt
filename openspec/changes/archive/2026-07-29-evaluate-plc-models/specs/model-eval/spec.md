## ADDED Requirements

### Requirement: The launch model choice is backed by a PLC-task comparison

The models Volt offers (and which tier they sit in) SHALL be chosen from evidence, not assumption — a comparison of
candidate models (at minimum DeepSeek vs Claude) on representative IEC 61131-3 tasks, run with an off-the-shelf
eval tool (no bespoke harness). The comparison SHALL cover generate / fix / refactor / explain tasks on realistic
Structured Text, and grade correctness (LLM-as-judge or manual, optionally a compile-based oracle via the Volt
bridge/LSP).

#### Scenario: DeepSeek-as-default is validated before launch
- **WHEN** the candidate models are run over the PLC task set and graded
- **THEN** there is a recorded per-task quality + cost comparison, and a decision on whether DeepSeek is good
  enough to be the default cheap tier or whether Claude must be the default — feeding the model catalog and
  pricing in `commercial-cloud-backend`
