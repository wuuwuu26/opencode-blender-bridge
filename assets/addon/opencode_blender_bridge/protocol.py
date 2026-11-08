"""Protocol constants and small helpers shared by the add-on and the host."""

import bpy

ADDON_NAME = "OpenCode Blender Bridge"
ADDON_VERSION = (1, 0, 1)
ADDON_PROTOCOL_VERSION = 1

DEFAULT_PORT = 9876

# Read-only commands are allowed while the user has paused AI operations.
PAUSE_SAFE_COMMANDS = {
    "ping",
    "get_addon_info",
    "get_scene_info",
    "get_object_info",
    "get_world_state_snapshot",
    "get_selection",
    "list_objects",
    "list_materials",
    "list_collections",
    "get_render_settings",
    "get_scene_stats",
    "audit_scene",
    "measure_object",
    "get_frame",
    "get_viewport_screenshot",
    "screenshot_area",
    "render_view",
    "find_merge_candidates",
    "get_perf_report",
    "save_snapshot",
    "get_marks",
}


def ai_paused():
    try:
        return bool(getattr(bpy.context.scene, "ocbb_ai_paused", False))
    except Exception:
        return False


def is_pause_safe_command(cmd):
    cmd = str(cmd or "")
    if cmd in PAUSE_SAFE_COMMANDS:
        return True
    return cmd.startswith("get_")


def redraw_view3d_panels():
    try:
        for wm in bpy.context.window_manager.windows:
            for area in wm.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
    except Exception:
        pass
