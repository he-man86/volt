#!/usr/bin/env bash
# Build bridge executables into bridges/dist/
# Requires: .NET 8 SDK, Windows x64
#
# Currently only the Beckhoff bridge is built. The TIA bridge lives in
# the reference Volt repo and isn't maintained here yet — when
# (if) we bring it over, add another `build_bridge` call below.
#
# Each bridge is built INDEPENDENTLY — a failure in one is summarized
# at the end, not aborted on. A previous version of this script used
# `set -e` which aborted on the first failure, silently leaving
# binaries stale.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"

# Resolve `dotnet`. On Windows the standard install location is the most
# reliable — a bare `dotnet` on PATH can point at a broken shim (observed
# in the wild: gives "No .NET SDKs were found" because the PATH entry is
# out of date). Prefer the known-good install path if it exists; only
# fall back to PATH on non-Windows or non-standard installs.
DOTNET=""
if [ -x "/c/Program Files/dotnet/dotnet.exe" ]; then
	DOTNET="/c/Program Files/dotnet/dotnet.exe"
elif [ -x "/c/Program Files (x86)/dotnet/dotnet.exe" ]; then
	DOTNET="/c/Program Files (x86)/dotnet/dotnet.exe"
elif command -v dotnet >/dev/null 2>&1; then
	DOTNET=dotnet
else
	echo "ERROR: dotnet not found at /c/Program Files/dotnet/ and not on PATH." >&2
	echo "       Install .NET 8 SDK from https://dot.net or add dotnet to PATH." >&2
	exit 1
fi

# Verify the chosen dotnet can actually find an SDK (some broken PATH
# entries exist but can't locate any SDK — we caught this in dev).
if ! "$DOTNET" --list-sdks >/dev/null 2>&1; then
	echo "ERROR: '$DOTNET' exists but cannot find any .NET SDKs." >&2
	echo "       Try: $DOTNET --list-sdks" >&2
	exit 1
fi

mkdir -p "$DIST_DIR"
echo "Using dotnet: $DOTNET"
echo

# Track per-bridge results so we can exit with a summary, not a silent
# early abort.
declare -a BUILT=()
declare -a FAILED=()
declare -a MANIFEST_ENTRIES=()

build_bridge() {
	local name="$1"
	local csproj="$2"
	local exe="$3"
	local manifest_key="$4"
	local extra_args="${5:-}"

	echo "Building $name..."
	# shellcheck disable=SC2086
	if "$DOTNET" publish "$csproj" -c Release -o "$DIST_DIR" --nologo -v quiet $extra_args; then
		echo "  -> $DIST_DIR/$exe"
		# Capture the built binary's actual reported version and stash it
		# for the manifest. The manifest is what bridges-version.test.ts
		# reads to verify each bridge matches version.json.
		local reported
		if reported=$("$DIST_DIR/$exe" --version 2>&1); then
			# Parse "BeckhoffBridge 3.8.5" → "3.8.5"
			local ver
			ver=$(echo "$reported" | awk '{print $NF}')
			MANIFEST_ENTRIES+=("\"$manifest_key\": \"$ver\"")
			BUILT+=("$name ($ver)")
		else
			echo "  !! $name built but failed --version check" >&2
			BUILT+=("$name (unknown version)")
		fi
	else
		echo "  !! $name build FAILED" >&2
		FAILED+=("$name")
	fi
	echo
}

build_bridge "Beckhoff Bridge" \
	"$SCRIPT_DIR/beckhoff/BeckhoffBridge/BeckhoffBridge.csproj" \
	"BeckhoffBridge.exe" \
	"beckhoff" \
	"-p:PublishTrimmed=false"

# CODESYS bridge — IronPython 2.7 inside CODESYS. No compile step;
# we produce TWO artifacts:
#   - CodesysBridge.zip       — source tree (for users who want to
#                                inspect / patch)
#   - volt-codesys-bridge.py  — single-file bundle (what the user
#                                picks in CODESYS's Tools > Scripting
#                                > Execute Script File dialog)
# Built independently of the Beckhoff bridge (same per-bridge
# isolation contract as build_bridge above).
build_codesys_bridge() {
	local bridge_src="$SCRIPT_DIR/codesys/CodesysBridge"
	local bundler="$SCRIPT_DIR/codesys/bundle.py"
	local zip_out="$DIST_DIR/CodesysBridge.zip"
	local single_out="$DIST_DIR/volt-codesys-bridge.py"
	local ver_file="$bridge_src/version.json"

	echo "Building CODESYS Bridge..."
	if [ ! -d "$bridge_src" ]; then
		echo "  !! source dir missing: $bridge_src" >&2
		FAILED+=("CODESYS Bridge")
		echo
		return
	fi

	# Strip any prior __pycache__ before packaging so users don't
	# import stale .pyc on the IronPython side.
	find "$bridge_src" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	rm -f "$zip_out" "$single_out"

	# 1. Source-tree zip (inspectable). Two paths because `zip` isn't
	# universally on PATH on Windows dev boxes; Python's shutil works
	# but needs Windows-style paths (otherwise `/c/Users/...` gets
	# misread as a UNC root and stat fails).
	if command -v zip >/dev/null 2>&1; then
		( cd "$SCRIPT_DIR/codesys" && zip -rq "$zip_out" CodesysBridge -x "*.pyc" -x "*__pycache__*" )
	else
		# Convert msys/Git-Bash paths (/c/Users/...) to Windows paths
		# (C:\Users\...) so Python on Windows doesn't choke on them.
		if command -v cygpath >/dev/null 2>&1; then
			local win_zip_base win_zip_root
			win_zip_base=$(cygpath -w "${zip_out%.zip}")
			win_zip_root=$(cygpath -w "$SCRIPT_DIR/codesys")
		else
			local win_zip_base="${zip_out%.zip}"
			local win_zip_root="$SCRIPT_DIR/codesys"
		fi
		python -c "import shutil; shutil.make_archive(r'$win_zip_base', 'zip', r'$win_zip_root', 'CodesysBridge')" \
			|| { echo "  !! zip failed (no zip + no python)" >&2; FAILED+=("CODESYS Bridge"); echo; return; }
	fi

	# 2. Single-file bundle — what users actually point CODESYS at.
	if ! python "$bundler" >/dev/null; then
		echo "  !! single-file bundle failed" >&2
		FAILED+=("CODESYS Bridge")
		echo
		return
	fi

	local ver
	if ver=$(python -c "import json; print(json.load(open('$ver_file'))['version'])" 2>/dev/null); then
		MANIFEST_ENTRIES+=("\"codesys\": \"$ver\"")
		BUILT+=("CODESYS Bridge ($ver)")
		echo "  -> $zip_out"
		echo "  -> $single_out"
	else
		BUILT+=("CODESYS Bridge (unknown version)")
		echo "  -> $zip_out (version parse failed)"
		echo "  -> $single_out"
	fi
	echo
}

build_codesys_bridge

echo "==================================="
echo "Build summary:"
if [ ${#BUILT[@]} -gt 0 ]; then
	echo "  Built:  ${BUILT[*]}"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
	echo "  Failed: ${FAILED[*]}"
fi
echo "==================================="

# Write manifest.json so bridges-version.test.ts can verify the built
# binaries match bridges/version.json. Only includes bridges that
# were successfully built in THIS run.
if [ ${#MANIFEST_ENTRIES[@]} -gt 0 ]; then
	manifest_body=$(IFS=,; echo "${MANIFEST_ENTRIES[*]}")
	timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
	cat > "$DIST_DIR/manifest.json" <<EOF
{
  "builtAt": "$timestamp",
  "bridges": { $manifest_body }
}
EOF
	echo "Wrote $DIST_DIR/manifest.json"
fi

# Exit non-zero only if EVERY bridge failed.
if [ ${#BUILT[@]} -eq 0 ]; then
	echo "ERROR: No bridges were built successfully." >&2
	exit 1
fi
