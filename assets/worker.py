"""Persistent headless Blender worker for OpenCode.

Launched as:
    blender -b --factory-startup --python assets/worker.py -- --port 50001 --addon-path <dir>

Prints a single ``OCBB_READY {...}`` line when the socket is listening, then
blocks on the main thread draining commands, so bpy stays single-threaded.
"""

import argparse
import json
import os
import sys


def _parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser(prog="ocbb-worker")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--addon-path", default="")
    parser.add_argument("--file", default="")
    parser.add_argument("--host", default="127.0.0.1")
    return parser.parse_args(argv)


def main():
    args = _parse_args()
    addon_path = os.path.abspath(args.addon_path) if args.addon_path else ""
    if addon_path and addon_path not in sys.path:
        sys.path.insert(0, addon_path)

    import bpy

    if args.file:
        path = os.path.abspath(os.path.expanduser(args.file))
        if os.path.exists(path):
            bpy.ops.wm.open_mainfile(filepath=path)

    from opencode_blender_bridge.server import BridgeServer

    bridge = BridgeServer(host=args.host, port=args.port, background=True)
    result = bridge.start(background=True)
    if not result.get("running"):
        print("OCBB_ERROR " + json.dumps(result), flush=True)
        raise SystemExit(2)
    print(
        "OCBB_READY "
        + json.dumps(
            {
                "port": bridge.port,
                "blender": bpy.app.version_string,
                "file": bpy.data.filepath or "",
                "pid": os.getpid(),
            }
        ),
        flush=True,
    )
    bridge.run_forever()


if __name__ == "__main__":
    main()
