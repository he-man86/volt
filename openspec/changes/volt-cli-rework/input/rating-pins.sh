#!/usr/bin/env bash
# pins.sh <volt-cli package dir> — sum each Repo.Gates ratchet table (a ratchet is exact, so its pins ARE the count).
cd "$1" || exit 1
for f in test/Volt.Repo.Gates/WireRulesHaveOneImplementationTests.cs test/Volt.Repo.Gates/NewVendorGateTests.cs; do
  [ -f "$f" ] || continue
  awk '/static readonly Dictionary<string, int> [A-Za-z]+Pins/ {match($0,/[A-Za-z]+Pins/); name=substr($0,RSTART,RLENGTH); s=0; n=0; on=1; next}
       on && /\["[^"]+"\] *= *[0-9]+/ {match($0,/= *[0-9]+/); v=substr($0,RSTART+1,RLENGTH-1)+0; s+=v; n++}
       on && /^\s*};/ {printf "%-22s %4d over %d files\n", name, s, n; on=0}' "$f"
done
