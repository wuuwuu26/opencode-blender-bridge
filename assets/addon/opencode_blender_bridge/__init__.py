"""OpenCode Blender Bridge add-on entry point.

Runs a small local TCP server inside Blender so an OpenCode agent can inspect
the scene, run Python, take pictures of the viewport, and export results.

Protocol: newline-less flat JSON.
    request  {"type": "get_scene_info", "params": {}}
    response {"status": "success", "result": {...}}
             {"status": "error", "message": "..."}
"""

bl_info = {
    "name": "OpenCode Blender Bridge",
    "author": "OpenCode Blender Bridge contributors",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > OpenCode",
    "description": "Local bridge that lets an OpenCode agent drive Blender",
    "doc_url": "https://github.com/wuuwuu26/opencode-blender-bridge",
    "category": "Interface",
}

from .protocol import ADDON_PROTOCOL_VERSION, ADDON_VERSION  # noqa: E402
from .registration import register, unregister  # noqa: E402,F401

__all__ = ["bl_info", "register", "unregister", "ADDON_PROTOCOL_VERSION", "ADDON_VERSION"]

if __name__ == "__main__":
    register()
