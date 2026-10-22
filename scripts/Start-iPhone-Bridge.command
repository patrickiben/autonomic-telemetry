#!/bin/bash
set -euo pipefail

TASK_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_REPO_ROOT="$(cd "$TASK_SCRIPT_DIR/.." && pwd)"
TASK_BRIDGE_ENV="$TASK_REPO_ROOT/.venv-bridge"

fail() {
  printf '\n%s\n' "$1" >&2
  if [[ -t 0 ]]; then
    read -r -p "Press Return to close this window. " TASK_DISMISS
  fi
  exit 1
}

cd "$TASK_REPO_ROOT"
[[ -f bridge/server.py ]] || fail "The bridge server is missing. Start this launcher from a complete repository download."

if [[ ! -x "$TASK_BRIDGE_ENV/bin/python" ]]; then
  TASK_PYTHON=""
  for TASK_CANDIDATE in python3.14 python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$TASK_CANDIDATE" >/dev/null 2>&1; then
      if "$TASK_CANDIDATE" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
        TASK_PYTHON="$(command -v "$TASK_CANDIDATE")"
        break
      fi
    fi
  done
  [[ -n "$TASK_PYTHON" ]] || fail "Install Python 3.10 or newer from https://www.python.org/downloads/macos/ and open this launcher again."
  printf 'Creating a local Python environment for the bridge.\n'
  "$TASK_PYTHON" -m venv "$TASK_BRIDGE_ENV" || fail "The Python environment could not be created. Check your Python installation and repository folder permissions."
fi

"$TASK_BRIDGE_ENV/bin/python" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' \
  || fail "This bridge environment uses an older Python. Remove the .venv-bridge folder, install Python 3.10 or newer, and launch again."

printf 'Checking the bridge dependencies. The first launch needs internet access.\n'
"$TASK_BRIDGE_ENV/bin/python" -m pip install --disable-pip-version-check -r bridge/requirements.txt \
  || fail "The bridge dependencies could not be installed. Check internet access and try this launcher again."

printf '\nStarting the local bridge. Keep this Terminal window open.\n'
printf 'Use the phone address printed below in Safari on the same trusted Wi-Fi.\n'
printf 'Press Control-C here when you want to stop the bridge.\n\n'
exec "$TASK_BRIDGE_ENV/bin/python" -m bridge.server --open "$@"
