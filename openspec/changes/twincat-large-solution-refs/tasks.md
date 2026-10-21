## 1. refs speed on large solutions
- [ ] 1.1 Reproduce with an 18-PLC-project solution; measure walk vs materialize
- [ ] 1.2 Bring `refs` under the 60 s relay budget (target < 10 s), or emit progress frames during it
- [ ] 1.3 Answer PLC Assist in proposal.md: speed or progress (decides their refs budget)

## 2. UInt32 OverflowException in refs
- [ ] 2.1 Locate the throw (stack trace) and the state abandoned refs calls leave behind
- [ ] 2.2 Fix; test: abandon N refs mid-run, the next refs succeeds

## 3. LinkAlways GVLs
- [ ] 3.1 Measure `<LinkAlways>` as a TwinCAT item property (as on CODESYS)
- [ ] 3.2 Round-trip test: pull + push a LinkAlways GVL keeps the property
