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
groups = [entry for entry in roots
          if isinstance(entry, dict) and "IOConsoleUsers" in entry]
if len(groups) != 1 or not isinstance(groups[0]["IOConsoleUsers"], list):
    raise ValueError("IORegistry console sessions unavailable")
root = groups[0]
fields = {"userId": "kCGSSessionUserIDKey", "onConsole": "kCGSSessionOnConsoleKey",
          "loginDone": "kCGSessionLoginDoneKey"}
missing = object()
console_lock = root.get("IOConsoleLocked", missing)
result = []
for entry in root["IOConsoleUsers"]:
    if not isinstance(entry, dict):
        raise ValueError("Invalid console-session entry")
    session = {name: entry.get(key) for name, key in fields.items()}
    session_lock = entry.get("CGSSessionScreenIsLocked", missing)
    if console_lock is True or session_lock is True:
        locked = True
    elif any(value is not missing and type(value) is not bool
             for value in (console_lock, session_lock)):
        locked = None
    elif session_lock is False:
        locked = False
    elif (console_lock is False and session["onConsole"] is True
          and session["loginDone"] is True
          and type(session["userId"]) is int and session["userId"] > 0):
        locked = False
    else:
        locked = None
    session["locked"] = locked
    result.append(session)
json.dump(result, sys.stdout)
