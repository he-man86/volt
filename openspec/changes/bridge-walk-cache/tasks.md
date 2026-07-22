## 1. Spike first — gates the whole change (DEFERRED)

- [ ] 1.1 Establish whether CODESYS AND TwinCAT expose a cheap, COMPREHENSIVE project-modification token / per-object change stamp. Actively try to break it: undo/redo, programmatic edits, a library version swap, an externally loaded file. If any mutation is missed, the cache is unsafe — close this change.
- [ ] 1.2 Only if 1.1 proves a trustworthy signal: design confirm-then-serve behind it (never assume-fresh). Otherwise, pursue per-item materialize speedups instead of a cache.

> Status: documented FUTURE OPTION. Not scheduled. Slow-but-correct is the current, deliberate choice.
