Owner decided C (proposal.md): PLCopen stays on TwinCAT. Section 2 and 3 are dropped; 1.1 and 4.1 remain. Requires `ld-fbd-coverage` archived.

## 1. Correct the docs (any option)

- [ ] 1.1 Fix the false parity claims: DIALECT N1 ("port unchanged": the constructors differ), `TcNetworkReader.cs:14-17`,
      `BeckhoffDriver.Content.cs:437-442`, ARCHITECTURE.md:123, volt-web `content.js:56`, D30, and the roundtrip
      multicoil comment.

## 2. ~~Measure A~~ (dropped: owner chose C) (needs the owner to allow the measurement registration, or an admin install on the dev machine)

- [ ] 2.1 Load a fixed-command package into TcXaeShell, and obtain a POU's live `INWLImplementationObject`.
- [ ] 2.2 Mutate it with vendor mutators only (construct, then set). Then save, close, reopen, build with 0 errors,
      open the editor, and check pull returns the same text. Cover:
      - LD and FBD;
      - a single-consumer branch, an unconnected pin, a parallel;
      - create, edit, rebuild.
- [ ] 2.3 Run CodesysNetworkReader/Writer against it, with the construct-then-set adaptation.

## 3. ~~Build the chosen option~~ (dropped)

- [ ] 3.1 A:
      - a vendor-neutral NWL project shared by both drivers;
      - the in-proc host and the installer step;
      - delete the PLCopen route and its refusals;
      - e2e on both vendors.
- [ ] 3.2 Or B: an archive builder from vendor templates, plus a save/reload/re-read gate.

## 4. Within the PLCopen route

- [ ] 4.1 For each PLCopen-only refusal (proposal "Why"), measure whether a PLCopen document can express it after all
      (e.g. the fan-out comes back reshaped, with importer leftovers). Spell what it can, keep refusing by name only what
      it measurably cannot, and record each in DIALECT.
