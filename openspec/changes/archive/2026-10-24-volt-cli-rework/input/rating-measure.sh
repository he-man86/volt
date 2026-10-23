#!/usr/bin/env bash
# measure.sh <volt-cli package dir> — the 1.0a / 4.0b counts, mechanically (C# only, bin/obj excluded).
# A comment line starts with //. Regexes are map-and-rating.md "How the counts were taken".
set -u
cd "$1" || exit 1
files() { find "$@" -name '*.cs' -not -path '*/bin/*' -not -path '*/obj/*' 2>/dev/null | sort; }
cat_all() { files "$@" | while IFS= read -r f; do cat "$f"; echo; done; }
VEND='Codesys|CODESYS|Twincat|TwinCAT|Beckhoff|Nwl|NWL|TcPOU|TcXae|XAE'
HIST='used to|no longer|\bwas (INTERNAL|a |the |once|briefly|deleted|removed)|\bIt was\b|\bonce (was|meant|made|wrote|held)|went with|is gone|are gone|is GONE|deleted;|\(deleted|since-deleted|before the fix|until [0-9]|Until 5|earlier today|ARCH FOLLOW-UP|the old |formerly|retired'
row() {
  local name="$1"; shift
  local t; t=$(mktemp); cat_all "$@" > "$t"
  local nf; nf=$(files "$@" | wc -l)
  local total blank comment code
  total=$(wc -l < "$t"); blank=$(( $(grep -cE '^\s*$' "$t") - nf )); comment=$(grep -cE '^\s*//' "$t")
  code=$(( total - nf - blank - comment ))
  printf '%-16s loc %6d/%5d/%5d  vendor %4d (%3d code)  history %3d  plcopen %3d  ??"" %3d\n' "$name" \
    $code $comment $blank \
    "$(grep -cE "$VEND" "$t")" "$(grep -E "$VEND" "$t" | grep -cvE '^\s*//')" \
    "$(grep -E '^\s*//' "$t" | grep -cE "$HIST")" "$(grep -cE 'PLCopen|PlcOpen' "$t")" \
    "$(grep -vE '^\s*//' "$t" | grep -cE '\?\? ""')"
  rm -f "$t"
}
facts() {
  local name="$1"; shift
  local n=0 m=0 k
  while IFS= read -r f; do k=$(grep -cE '^\s*\[(Fact|Theory)' "$f"); [ "$k" -gt 0 ] && { n=$((n+k)); m=$((m+1)); }; done < <(files "$@")
  printf '%-16s facts %5d (%d files)\n' "$name" $n $m
}
code_hits() { local label="$1" re="$2"; shift 2; printf '%-40s %s\n' "$label" "$(cat_all "$@" | grep -vE '^\s*//' | grep -cE "$re")"; }
any_hits() { local label="$1" re="$2"; shift 2; printf '%-40s %s\n' "$label" "$(cat_all "$@" | grep -cE "$re")"; }

echo "== projects (code/comment/blank)"
row "Engine(+Host)" src/Volt.Engine src/Volt.Engine.Host
row "  Engine Seam/" src/Volt.Engine/Seam
row "Ide.Codesys" src/Volt.Ide.Codesys
row "Ide.Twincat" src/Volt.Ide.Twincat
row "Contracts" src/Volt.Contracts
row "Wire" src/Volt.Wire
row "Cli" src/Volt.Cli
echo "== test facts"
facts "Engine.Tests" test/Volt.Engine.Tests
facts "Codesys.Tests" test/Volt.Ide.Codesys.Tests
facts "Twincat.Tests" test/Volt.Ide.Twincat.Tests
facts "Contracts.Tests" test/Volt.Contracts.Tests
facts "Cli.Tests" test/Volt.Cli.Tests
facts "Repo.Gates" test/Volt.Repo.Gates
echo "== named findings (code lines unless 'any')"
code_hits "IsAbstract definitions (Engine)"       'static bool [A-Za-z]*IsAbstract\(string' src/Volt.Engine
code_hits "\"push-reject\" walks (RejectAll)"      '"push-reject"' src/Volt.Engine
code_hits "OrdinalIgnoreCase (Engine+Host)"        'OrdinalIgnoreCase' src/Volt.Engine src/Volt.Engine.Host
code_hits "GetObjectToModify (C1)"                 'GetObjectToModify' src/Volt.Ide.Codesys
code_hits "Bits( definitions (T3)"                 'static [A-Za-z<>]+ Bits\(' src/Volt.Ide.Twincat
code_hits "List<object> (C2)"                      'List<object>' src/Volt.Ide.Codesys
code_hits "ParseLine/ParseColumn (C3)"             'Parse(Line|Column)\(' src/Volt.Ide.Codesys
code_hits "OutputSlots definitions (D1, both)"     'static [A-Za-z<>?]+ OutputSlots\(' src/Volt.Ide.Codesys src/Volt.Ide.Twincat
any_hits  "ARCH FOLLOW-UP (any)"                   'ARCH FOLLOW-UP' src
any_hits  "offline doubles (any, TC)"              'offline doubles' src/Volt.Ide.Twincat
code_hits "catch (RuntimeBinderException (TC)"     'catch \(RuntimeBinderException' src/Volt.Ide.Twincat
echo "== largest src files (lines)"
files src | xargs wc -l | sort -rn | sed -n 2,6p
