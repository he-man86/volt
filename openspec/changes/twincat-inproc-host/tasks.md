Owner decided C (proposal.md): PLCopen stays on TwinCAT. Options A/B are dropped (research.md keeps how they were measured). Requires `ld-fbd-coverage` archived.

## 1. Correct the docs

- [ ] 1.1 Fix the false parity claims: DIALECT N1 ("port unchanged": the constructors differ), `TcNetworkReader.cs:14-17`,
      `BeckhoffDriver.Content.cs:437-442`, ARCHITECTURE.md:123, volt-web `content.js:56`, D30, and the roundtrip
      multicoil comment.

## 4. Within the PLCopen route

- [ ] 4.1 For each PLCopen-only refusal (proposal "Why"), measure whether a PLCopen document can express it after all
      (e.g. the fan-out comes back reshaped, with importer leftovers). Spell what it can, keep refusing by name only what
      it measurably cannot, and record each in DIALECT.
