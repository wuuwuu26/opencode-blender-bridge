"""Command registry: every command the host may call over the socket."""

from .audit import AuditCommands
from .core import CoreCommands
from .materials import MaterialCommands
from .objects import ObjectCommands
from .scene import SceneCommands
from .screenshot import ScreenshotCommands


class BridgeCommands(
    CoreCommands,
    ObjectCommands,
    MaterialCommands,
    SceneCommands,
    ScreenshotCommands,
    AuditCommands,
):
    pass


COMMAND_NAMES = {
    # core / inspection
    "ping",
    "get_addon_info",
    "get_scene_info",
    "get_object_info",
    "get_world_state_snapshot",
    "get_selection",
    "set_selection",
    "list_objects",
    "get_scene_stats",
    "execute_code",
    "save_snapshot",
    "get_marks",
    "restore_marks",
    # objects
    "add_primitive",
    "add_empty",
    "add_camera",
    "add_light",
    "set_transform",
    "apply_transform",
    "set_origin",
    "delete_objects",
    "duplicate_object",
    "join_objects",
    "rename_object",
    "set_parent",
    "shade_smooth",
    "add_modifier",
    "apply_modifier",
    "convert_to_mesh",
    "import_file",
    # materials
    "list_materials",
    "create_material",
    "assign_material",
    "set_material_property",
    "remove_material",
    # scene / render / files
    "set_frame",
    "get_frame",
    "get_render_settings",
    "set_render_settings",
    "set_camera",
    "render_still",
    "export_scene",
    "save_blend",
    "open_blend",
    "list_collections",
    "create_collection",
    "link_to_collection",
    "set_world",
    # screenshots
    "get_viewport_screenshot",
    "screenshot_area",
    "render_view",
    # audit / perf
    "audit_scene",
    "measure_object",
    "find_merge_candidates",
    "get_perf_report",
    "apply_perf_settings",
}

__all__ = ["BridgeCommands", "COMMAND_NAMES"]
