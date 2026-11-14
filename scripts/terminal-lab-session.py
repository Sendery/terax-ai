"""Extract only graphical-session readiness fields from macOS IORegistry plist."""
import json
import plistlib
import sys

LIMIT = 16 * 1024 * 1024
raw = sys.stdin.buffer.read(LIMIT + 1)
if len(raw) > LIMIT:
    raise ValueError("IORegistry plist exceeds byte limit")
roots = plistlib.loads(raw)
if isinstance(roots, dict):
    roots = [roots]
if not isinstance(roots, list):
    raise ValueError("IORegistry root must be an object or array")
groups = [entry["IOConsoleUsers"] for entry in roots
          if isinstance(entry, dict) and "IOConsoleUsers" in entry]
if len(groups) != 1 or not isinstance(groups[0], list):
    raise ValueError("IORegistry console sessions unavailable")
fields = {"userId": "kCGSSessionUserIDKey", "onConsole": "kCGSSessionOnConsoleKey",
          "loginDone": "kCGSessionLoginDoneKey", "locked": "CGSSessionScreenIsLocked"}
result = []
for entry in groups[0]:
    if not isinstance(entry, dict):
        raise ValueError("Invalid console-session entry")
    result.append({name: entry.get(key) for name, key in fields.items()})
json.dump(result, sys.stdout)
