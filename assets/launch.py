"""Launch Blender with the OpenCode bridge enabled, without installing the add-on.

    blender --python assets/launch.py -- --addon-path <dir> --port 9876 [--file x.blend]
"""

import argparse
import os
import sys


def _parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(prog="ocbb-launch")
    parser.add_argument("--addon-path", default="")
    parser.add_argument("--port", type=int, default=9876)
    parser.add_argument("--file", default="")
    parser.add_argument("--workspace", default="")
    return parser.parse_args(argv)


def main():
    args = _parse_args()
    import bpy

    if args.workspace:
        try:
            bpy.context.preferences.filepaths.use_relative_paths = False
        except Exception:
            pass

    addon_path = os.path.abspath(args.addon_path) if args.addon_path else ""
    if addon_path and addon_path not in sys.path:
        sys.path.insert(0, addon_path)

    enabled = False
    try:
        enabled = "opencode_blender_bridge" in bpy.context.preferences.addons
    except Exception:
        enabled = False

    if enabled:
        import opencode_blender_bridge  # noqa: F401
    else:
        import opencode_blender_bridge

        opencode_blender_bridge.register()

    from opencode_blender_bridge import server as server_module

    bpy.context.scene.ocbb_port = int(args.port)
    result = server_module.start_server(port=args.port, background=False)
    print("OCBB_LAUNCH " + str(result), flush=True)

    if args.file:
        path = os.path.abspath(os.path.expanduser(args.file))
        if os.path.exists(path):
            bpy.ops.wm.open_mainfile(filepath=path)


if __name__ == "__main__":
    main()
