#!/usr/bin/env python3
"""Runs a program in a PTY and records output chunks and resizes. See README.md."""
import os, pty, sys, time, select, fcntl, termios, struct, signal, json
out_path, script = sys.argv[1], json.loads(sys.argv[2])
cols, rows = script["size"]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(script["cwd"])
    env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", TERM_PROGRAM="ghostty")
    env.pop("TERAX_PI_DISCOVERY", None)
    os.execvpe(script["argv"][0], script["argv"], env)
def setsize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
setsize(cols, rows)
log = open(out_path, "wb")
events = []
def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: data = os.read(fd, 65536)
            except OSError: return
            if not data: return
            events.append(["out", data.hex()])
            # answer DA/cursor queries minimally so TUIs do not stall
            if b"\x1b[6n" in data: os.write(fd, b"\x1b[%d;1R" % rows)
            if b"\x1b[c" in data: os.write(fd, b"\x1b[?62;22c")
try:
  for step in script["steps"]:
    kind = step[0]
    if kind == "wait": pump(step[1])
    elif kind == "resize":
        setsize(step[1], step[2]); events.append(["resize", step[1], step[2]]); os.kill(pid, signal.SIGWINCH); pump(step[3])
    elif kind == "type":
        os.write(fd, step[1].encode()); events.append(["in", step[1]]); pump(step[2])
except OSError as e:
  events.append(["error", str(e)])
finally:
  log.close(); json.dump({"size": [cols, rows], "events": events}, open(out_path, "w"))
try: os.kill(pid, signal.SIGKILL)
except Exception: pass
