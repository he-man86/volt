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

# Desktop deploy targets. The bridges run from this location during dev
# (TwinCAT XAE loads `BeckhoffBridge.exe`, CODESYS picks
# `volt-codesys-bridge.py` from a Tools > Scripting dialog). Every
# rebuild MUST refresh every copy so we never deploy a stale binary
# against a freshly-bumped wire protocol.
#
# Why a LIST not a single path: on Windows with OneDrive Personal +
# non-English locale, `%USERPROFILE%\Desktop` is a different folder from
# what Explorer shows on the user's actual desktop. Common variants:
#   %USERPROFILE%\Desktop           (classic, exists but often unused)
#   %USERPROFILE%\OneDrive\Desktop  (OneDrive sync, English locale)
#   %USERPROFILE%\OneDrive\Bureaublad   (Dutch — "Bureaublad" = "Desktop")
#   %USERPROFILE%\OneDrive\Schreibtisch (German)
#   %USERPROFILE%\OneDrive\Bureau   (French)
#   %USERPROFILE%\OneDrive\Escritorio   (Spanish)
# Deploying to a single guess silently strands a stale copy on the
# user's actual desktop — exactly the bug that hid the 5.0.0 → 5.1.0
# CODESYS-bridge rollout for an entire dev cycle. So we resolve EVERY
# candidate that exists and copy to all of them. Cheap (one small file)
# and impossible to miss the right one.
#
# `USERPROFILE` works on Git Bash / MSYS; falls back to $HOME on other
# shells. If neither resolves (CI, headless), the deploy step is
# skipped cleanly — the build is still useful via `dist/`.
DESKTOP_DIRS=()
_USER_HOME="${USERPROFILE:-$HOME}"
if [ -n "$_USER_HOME" ]; then
	for sub in \
		"Desktop" \
		"OneDrive/Desktop" \
		"OneDrive/Bureaublad" \
		"OneDrive/Schreibtisch" \
		"OneDrive/Bureau" \
		"OneDrive/Escritorio" \
		"OneDrive/桌面" \
		"OneDrive/デスクトップ"
	do
		candidate="$_USER_HOME/$sub"
		if [ -d "$candidate" ]; then
			DESKTOP_DIRS+=("$candidate")
		fi
	done
fi

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

deploy_to_desktop() {
	local artifact="$1"      # path under DIST_DIR
	local target_subpath="$2" # relative path under each desktop dir
	if [ ${#DESKTOP_DIRS[@]} -eq 0 ]; then
		echo "  (no Desktop dir detected — skipping deploy of $artifact)"
		return
	fi
	if [ ! -f "$DIST_DIR/$artifact" ]; then
		echo "  (artifact $artifact not built — skipping desktop deploy)" >&2
		return
	fi
	# Copy to EVERY detected desktop. The localized OneDrive-synced
	# folder (Bureaublad / Schreibtisch / Bureau / etc.) is what
	# Explorer actually shows on Windows with OneDrive Personal;
	# %USERPROFILE%\Desktop is often a stale shadow folder. Hitting
	# both means a single rebuild always lands on the user's REAL
	# desktop regardless of OneDrive/locale setup.
	for desktop in "${DESKTOP_DIRS[@]}"; do
		local dest="$desktop/$target_subpath"
		mkdir -p "$(dirname "$dest")"
		if cp -f "$DIST_DIR/$artifact" "$dest"; then
			echo "  -> deployed to $dest"
		else
			echo "  !! desktop deploy FAILED for $dest" >&2
			echo "     (is the running bridge holding the file?)" >&2
		fi
	done
}

# Deploy Beckhoff binary alongside its existing runtime files on the
# desktop. Single-file bundle (PublishSingleFile=true in csproj), so
# one .exe is the entire deployment.
if [[ " ${BUILT[*]} " == *"Beckhoff Bridge"* ]]; then
	deploy_to_desktop "BeckhoffBridge.exe" "BeckhoffBridge/BeckhoffBridge.exe"
fi

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

if [[ " ${BUILT[*]} " == *"CODESYS Bridge"* ]]; then
	deploy_to_desktop "volt-codesys-bridge.py" "volt-codesys-bridge.py"
fi

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
