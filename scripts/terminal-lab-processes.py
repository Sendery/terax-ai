"""Read macOS kernel process birth identities without inspecting arguments or environments."""
import ctypes
import json
import sys


class ProcessInfo(ctypes.Structure):
    _fields_ = (
        [(name, ctypes.c_uint32) for name in (
            "flags", "status", "xstatus", "pid", "ppid", "uid", "gid",
            "ruid", "rgid", "svuid", "svgid", "reserved",
        )]
        + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)]
        + [(name, ctypes.c_uint32) for name in (
            "nfiles", "pgid", "jobc", "tdev", "tpgid",
        )]
        + [("nice", ctypes.c_int32), ("start_sec", ctypes.c_uint64),
           ("start_usec", ctypes.c_uint64)]
    )


def main():
    if sys.platform != "darwin":
        raise RuntimeError("Process birth identities require macOS libproc")
    pids = json.load(sys.stdin)
    if not isinstance(pids, list) or len(pids) > 10000 or any(
        type(pid) is not int or pid <= 0 or pid > 2147483647 for pid in pids
    ):
        raise ValueError("Invalid PID list")
    lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidinfo.restype = ctypes.c_int
    result = []
    for pid in pids:
        info = ProcessInfo()
        size = lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info))
        if (size == ctypes.sizeof(info) and info.pid == pid
                and info.start_sec > 0 and info.start_usec < 1000000):
            result.append({"pid": pid, "ppid": info.ppid, "pgid": info.pgid,
                           "birth": f"{info.start_sec}:{info.start_usec}"})
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
