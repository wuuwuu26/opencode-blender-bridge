"""Registration, scene properties and auto-start."""

import bpy

from . import server as server_module
from .protocol import DEFAULT_PORT
from .ui import CLASSES as UI_CLASSES

_AUTO_START_ATTEMPTS = 0


def _preferences():
    try:
        return bpy.context.preferences.addons[__package__].preferences
    except Exception:
        return None


def _auto_start_timer():
    global _AUTO_START_ATTEMPTS
    if bpy.app.background:
        return None
    prefs = _preferences()
    if prefs is None or not prefs.auto_start:
        return None
    instance = server_module.get_server()
    if instance and instance.running:
        try:
            bpy.context.scene.ocbb_server_running = True
        except Exception:
            pass
        return None
    port = int(getattr(bpy.context.scene, "ocbb_port", prefs.port) or prefs.port)
    result = server_module.start_server(port=port, background=False)
    if result.get("running"):
        try:
            bpy.context.scene.ocbb_server_running = True
        except Exception:
            pass
        print("[OpenCode Bridge] auto-started on port %d" % port, flush=True)
        return None
    _AUTO_START_ATTEMPTS += 1
    if _AUTO_START_ATTEMPTS < 5:
        return 2.0
    print("[OpenCode Bridge] auto-start gave up: %s" % result.get("error", "unknown"), flush=True)
    return None


def register():
    global _AUTO_START_ATTEMPTS
    _AUTO_START_ATTEMPTS = 0
    bpy.types.Scene.ocbb_port = bpy.props.IntProperty(
        name="Port",
        description="Local TCP port for the OpenCode bridge",
        default=DEFAULT_PORT,
        min=1024,
        max=65535,
    )
    bpy.types.Scene.ocbb_ai_paused = bpy.props.BoolProperty(
        name="Pause AI",
        description="Reject write commands from OpenCode until resumed",
        default=False,
    )
    bpy.types.Scene.ocbb_server_running = bpy.props.BoolProperty(
        name="Bridge Running",
        default=False,
        options={"HIDDEN"},
    )
    for cls in UI_CLASSES:
        bpy.utils.register_class(cls)
    try:
        bpy.app.timers.register(_auto_start_timer, first_interval=1.5)
    except Exception:
        pass
    print("[OpenCode Bridge] add-on registered", flush=True)


def unregister():
    try:
        bpy.app.timers.unregister(_auto_start_timer)
    except Exception:
        pass
    try:
        server_module.stop_server()
    except Exception:
        pass
    for cls in reversed(UI_CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except Exception:
            pass
    for name in ("ocbb_port", "ocbb_ai_paused", "ocbb_server_running"):
        try:
            delattr(bpy.types.Scene, name)
        except Exception:
            pass
    print("[OpenCode Bridge] add-on unregistered", flush=True)
