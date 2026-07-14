## Why

Volt's subscription margin rests on one untested assumption: **DeepSeek is good enough at IEC 61131-3 for the
PLC agent**, so it can be the cheap default and Claude the premium upsell (see `commercial-cloud-backend`, the
pricing model). If DeepSeek produces worse Structured Text / ladder logic on real PLC tasks, the whole
budget-tier story changes — Claude may have to be the default, which reshapes pricing. This is a **testable
assumption right now**, with no backend and no custom harness. Better to know before building the business on it.

## What Changes

Run an **evidence-based model comparison** — DeepSeek vs Claude (and optionally others) — on representative PLC
coding tasks, using an **off-the-shelf eval tool** (no bespoke harness):

- **Tool:** [Promptfoo](https://promptfoo.dev) — config-only (YAML: prompts + models + assertions), runs models
  side-by-side, LLM-as-judge grading built in, supports Anthropic + OpenAI-compatible (DeepSeek) providers.
  (Hosted alternatives if preferred: Braintrust / LangSmith.)
- **Tasks:** ~10 representative IEC 61131-3 tasks a Volt user would actually ask — write a POU (e.g. debounce,
  scaling, state machine), fix a bug in given ST/ladder, refactor an FB, explain a fault. Hand-written, not code.
- **Grading, cheapest first:** LLM-as-judge (Promptfoo built-in) or manual review for ~10 tasks. **Volt's edge —
  optional, later:** compile the generated ST with the Volt bridge/LSP as the oracle ("does it build clean?"),
  a domain grader nobody else has.

## Impact

- **New:** an `eval/` config + prompt set (Promptfoo YAML + `.txt` prompts). No product code; no backend.
- **Feeds `commercial-cloud-backend`:** the result decides the launch model catalog (Stage 4b) and whether the
  pricing tiers gate models or just usage. Purely additive — nothing depends on it shipping.
- **Cost:** a few dollars of DeepSeek + Anthropic API usage. Needs a DeepSeek key + an Anthropic key.
