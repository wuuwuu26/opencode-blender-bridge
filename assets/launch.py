"""Launch Blender with the OpenCode bridge enabled, without installing the add-on.

    blender --python assets/launch.py -- --addon-path <dir> --port 9876 [--file x.blend]

Prefer the add-on installed in Blender preferences. Only when nothing is
installed do we import the bundled copy, so the two can never register over
each other (which breaks class registration and the bridge).
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


def _installed_addon_exists():
    import bpy

    for base in bpy.utils.script_paths():
        if os.path.isfile(os.path.join(base, "addons", "opencode_blender_bridge", "__init__.py")):
            return True
    return False


def main():
    args = _parse_args()
    import bpy

    if args.workspace:
        try:
            bpy.context.preferences.filepaths.use_relative_paths = False
        except Exception:
            pass

    addon_path = os.path.abspath(args.addon_path) if args.addon_path else ""
    registered = hasattr(bpy.types.Scene, "ocbb_port")

    if not registered and _installed_addon_exists():
        try:
            bpy.ops.preferences.addon_enable(module="opencode_blender_bridge")
            registered = hasattr(bpy.types.Scene, "ocbb_port")
        except Exception:
            registered = False

    if not registered:
        if addon_path and addon_path not in sys.path:
            sys.path.insert(0, addon_path)
        import opencode_blender_bridge

        opencode_blender_bridge.register()

    from opencode_blender_bridge import server as server_module

    try:
        bpy.context.scene.ocbb_port = int(args.port)
    except Exception:
        pass
    result = server_module.start_server(port=args.port, background=False)
    print("OCBB_LAUNCH " + str(result), flush=True)

    if args.file:
        path = os.path.abspath(os.path.expanduser(args.file))
        if os.path.exists(path):
            bpy.ops.wm.open_mainfile(filepath=path)


if __name__ == "__main__":
    main()
