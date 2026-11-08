"""Sidebar panel, operators and preferences for the add-on."""

import bpy

from . import server as server_module
from .protocol import ADDON_NAME, ADDON_VERSION, DEFAULT_PORT


class OCBB_AddonPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    auto_start: bpy.props.BoolProperty(
        name="Start bridge when Blender loads",
        description="Listen for OpenCode as soon as the add-on is enabled",
        default=True,
    )
    port: bpy.props.IntProperty(
        name="Port",
        description="Local TCP port used by the bridge",
        default=DEFAULT_PORT,
        min=1024,
        max=65535,
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "auto_start")
        layout.prop(self, "port")
        layout.label(text="The bridge only listens on 127.0.0.1.", icon="LOCKED")


class OCBB_OT_StartServer(bpy.types.Operator):
    bl_idname = "ocbb.start_server"
    bl_label = "Connect"
    bl_description = "Start the local bridge so OpenCode can drive Blender"

    def execute(self, context):
        result = server_module.start_server(port=context.scene.ocbb_port)
        if not result.get("running"):
            self.report({"ERROR"}, "Could not start bridge: %s" % result.get("error", "unknown error"))
            return {"CANCELLED"}
        context.scene.ocbb_server_running = True
        self.report({"INFO"}, "OpenCode bridge listening on 127.0.0.1:%d" % context.scene.ocbb_port)
        return {"FINISHED"}


class OCBB_OT_StopServer(bpy.types.Operator):
    bl_idname = "ocbb.stop_server"
    bl_label = "Disconnect"
    bl_description = "Stop the local bridge"

    def execute(self, context):
        server_module.stop_server()
        context.scene.ocbb_server_running = False
        return {"FINISHED"}


class OCBB_OT_TogglePause(bpy.types.Operator):
    bl_idname = "ocbb.toggle_pause"
    bl_label = "Pause / Resume AI"
    bl_description = "When paused, write commands from OpenCode are rejected"

    def execute(self, context):
        context.scene.ocbb_ai_paused = not context.scene.ocbb_ai_paused
        return {"FINISHED"}


class OCBB_PT_Panel(bpy.types.Panel):
    bl_label = "OpenCode"
    bl_idname = "OCBB_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "OpenCode"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        instance = server_module.get_server()
        running = bool(instance and instance.running)
        box = layout.box()
        row = box.row()
        row.label(text="Bridge", icon="LINKED" if running else "UNLINKED")
        row.label(text="Listening" if running else "Offline")
        if running:
            box.label(text="127.0.0.1:%d" % instance.port, icon="NETWORK_DRIVE")
        else:
            box.label(text="Start it, then ask the agent to connect", icon="INFO")
        row = box.row(align=True)
        if running:
            row.operator("ocbb.stop_server", icon="CANCEL")
        else:
            row.operator("ocbb.start_server", icon="PLAY")
        box.prop(scene, "ocbb_port")
        layout.separator()
        row = layout.row()
        row.prop(
            scene,
            "ocbb_ai_paused",
            text="Pause AI",
            icon="PAUSE" if not scene.ocbb_ai_paused else "PLAY",
            toggle=True,
        )
        if scene.ocbb_ai_paused:
            layout.label(text="Write commands are rejected", icon="ERROR")
        layout.separator()
        col = layout.column(align=True)
        col.label(text="%s %d.%d.%d" % ((ADDON_NAME,) + ADDON_VERSION), icon="PLUGIN")
        col.label(text="OpenCode drives Blender over 127.0.0.1")


CLASSES = (
    OCBB_AddonPreferences,
    OCBB_OT_StartServer,
    OCBB_OT_StopServer,
    OCBB_OT_TogglePause,
    OCBB_PT_Panel,
)
