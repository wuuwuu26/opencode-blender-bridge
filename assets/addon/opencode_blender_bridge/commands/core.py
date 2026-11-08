"""Core inspection, code execution and runtime state commands."""

import io
import json
import os
import sys
import traceback
from contextlib import redirect_stdout, redirect_stderr

import bpy
from mathutils import Vector

from .. import bpy_utils as U
from ..protocol import ADDON_NAME, ADDON_PROTOCOL_VERSION, ADDON_VERSION

MAX_SNAPSHOT_OBJECTS = 2000


class Kernel:
    """State that survives between execute_code calls in one Blender session."""

    def __init__(self):
        self.vars = {}
        self.out_dir = os.environ.get("OCBB_OUT_DIR", "")
        self.args = []
        self._namespace = None

    @property
    def blend_path(self):
        return bpy.data.filepath or ""

    @property
    def blend_dir(self):
        return os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.getcwd()

    def run(self, path):
        path = os.path.abspath(os.path.expanduser(path))
        with open(path, "r", encoding="utf-8") as handle:
            source = handle.read()
        code = compile(source, path, "exec")
        namespace = self.namespace
        old_file = namespace.get("__file__")
        namespace["__file__"] = path
        try:
            exec(code, namespace)
        finally:
            if old_file is None:
                namespace.pop("__file__", None)
            else:
                namespace["__file__"] = old_file

    @property
    def namespace(self):
        if self._namespace is None:
            self._namespace = {
                "__name__": "__ocbb_kernel__",
                "bpy": bpy,
                "K": self,
                "math": __import__("math"),
                "os": os,
                "sys": sys,
                "json": json,
                "Vector": Vector,
                "mathutils": __import__("mathutils"),
            }
        return self._namespace


class CoreCommands:
    def __init__(self):
        self.kernel = Kernel()

    def ping(self, **_ignored):
        return {"pong": True}

    def get_addon_info(self):
        names = []
        try:
            from ..commands import COMMAND_NAMES

            names = sorted(COMMAND_NAMES)
        except Exception:
            pass
        return {
            "name": ADDON_NAME,
            "addon_version": list(ADDON_VERSION),
            "protocol_version": ADDON_PROTOCOL_VERSION,
            "blender_version": bpy.app.version_string,
            "background": bool(bpy.app.background),
            "python_version": sys.version.split()[0],
            "capabilities": names,
            "file": bpy.data.filepath or "",
            "scene": bpy.context.scene.name if bpy.context.scene else "",
        }

    def get_scene_info(self, limit=50):
        scene = bpy.context.scene
        limit = max(1, min(int(limit or 50), 2000))
        objects = []
        for i, obj in enumerate(scene.objects):
            if i >= limit:
                break
            objects.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": U.vec(obj.location),
                    "visible": bool(obj.visible_get()),
                    "parent": obj.parent.name if obj.parent else None,
                    "materials": U.material_names(obj),
                }
            )
        lo, hi, radius = U.scene_bbox()
        return {
            "name": scene.name,
            "file": bpy.data.filepath or "",
            "frame": scene.frame_current,
            "engine": scene.render.engine,
            "object_count": len(scene.objects),
            "objects": objects,
            "truncated": len(scene.objects) > limit,
            "materials_count": len(bpy.data.materials),
            "collections_count": len(bpy.data.collections),
            "bbox": {"min": U.vec(lo), "max": U.vec(hi), "radius": round(radius, 4)},
            "camera": scene.camera.name if scene.camera else None,
        }

    def get_object_info(self, name):
        obj = U.get_object(name)
        info = {
            "name": obj.name,
            "type": obj.type,
            "location": U.vec(obj.location),
            "rotation_degrees": [round(float(v) * 57.29577951308232, 4) for v in obj.rotation_euler],
            "scale": U.vec(obj.scale),
            "dimensions": U.vec(obj.dimensions),
            "visible": bool(obj.visible_get()),
            "hide_render": bool(obj.hide_render),
            "parent": obj.parent.name if obj.parent else None,
            "collections": [c.name for c in obj.users_collection],
            "materials": U.material_names(obj),
            "modifiers": [
                {"name": m.name, "type": m.type, "show_viewport": bool(m.show_viewport)}
                for m in obj.modifiers
            ],
            "custom_properties": {
                k: str(v)[:200]
                for k, v in obj.items()
                if k != "_RNA_UI" and isinstance(k, str) and not k.startswith("_")
            },
        }
        if obj.type == "MESH" and obj.data:
            mesh = obj.data
            used = set()
            for edge in mesh.edges:
                used.update(edge.vertices)
            info["mesh"] = {
                "vertices": len(mesh.vertices),
                "edges": len(mesh.edges),
                "polygons": len(mesh.polygons),
                "triangles": sum(max(1, len(p.vertices) - 2) for p in mesh.polygons),
                "loose_vertices": sum(1 for v in mesh.vertices if v.index not in used),
            }
            try:
                lo, hi = U.world_bbox(obj)
                info["world_bbox"] = {"min": U.vec(lo), "max": U.vec(hi)}
            except Exception:
                pass
        return info

    def get_world_state_snapshot(self, limit=MAX_SNAPSHOT_OBJECTS, selected_limit=1000):
        scene = bpy.context.scene
        limit = max(1, min(int(limit or MAX_SNAPSHOT_OBJECTS), 20000))
        objects = []
        for i, obj in enumerate(scene.objects):
            if i >= limit:
                break
            objects.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": U.vec(obj.location),
                    "rotation": [round(float(v), 5) for v in obj.rotation_euler],
                    "scale": U.vec(obj.scale),
                    "visible": bool(obj.visible_get()),
                    "parent": obj.parent.name if obj.parent else None,
                    "materials": U.material_names(obj),
                    "collection": obj.users_collection[0].name if obj.users_collection else "",
                    "polygons": len(obj.data.polygons) if obj.type == "MESH" and obj.data else 0,
                }
            )
        selected = [o.name for o in bpy.context.selected_objects if o.name][: max(1, int(selected_limit or 1000))]
        lo, hi, radius = U.scene_bbox()
        return {
            "scene": scene.name,
            "file": bpy.data.filepath or "",
            "frame": scene.frame_current,
            "engine": scene.render.engine,
            "object_count": len(scene.objects),
            "objects": objects,
            "truncated": len(scene.objects) > limit,
            "selected": selected,
            "active": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
            "camera": scene.camera.name if scene.camera else None,
            "bbox": {"min": U.vec(lo), "max": U.vec(hi), "radius": round(radius, 4)},
        }

    def get_selection(self):
        return {
            "selected": [o.name for o in bpy.context.selected_objects],
            "active": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
        }

    def set_selection(self, names=None, active=None):
        found = U.select_only(names or [])
        if active:
            obj = bpy.data.objects.get(str(active))
            if obj:
                bpy.context.view_layer.objects.active = obj
        return {"selected": [o.name for o in found], "active": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None}

    def list_objects(self, type_filter=None, limit=1000, selected_only=False):
        limit = max(1, min(int(limit or 1000), 20000))
        result = []
        source = bpy.context.selected_objects if selected_only else bpy.context.scene.objects
        for obj in source:
            if type_filter and obj.type != str(type_filter).upper():
                continue
            result.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": U.vec(obj.location),
                    "dimensions": U.vec(obj.dimensions),
                    "materials": U.material_names(obj),
                    "parent": obj.parent.name if obj.parent else None,
                    "visible": bool(obj.visible_get()),
                }
            )
            if len(result) >= limit:
                break
        return {"objects": result, "count": len(result), "truncated": len(result) >= limit}

    def get_scene_stats(self):
        scene = bpy.context.scene
        types = {}
        total_polys = 0
        total_verts = 0
        for obj in scene.objects:
            types[obj.type] = types.get(obj.type, 0) + 1
            if obj.type == "MESH" and obj.data:
                total_polys += len(obj.data.polygons)
                total_verts += len(obj.data.vertices)
        lo, hi, radius = U.scene_bbox()
        return {
            "scene": scene.name,
            "file": bpy.data.filepath or "",
            "frame": scene.frame_current,
            "objects": len(scene.objects),
            "object_types": types,
            "total_polygons": total_polys,
            "total_vertices": total_verts,
            "materials": len(bpy.data.materials),
            "images": len(bpy.data.images),
            "collections": len(bpy.data.collections),
            "lights": len([o for o in scene.objects if o.type == "LIGHT"]),
            "cameras": len([o for o in scene.objects if o.type == "CAMERA"]),
            "bbox": {"min": U.vec(lo), "max": U.vec(hi), "radius": round(radius, 4)},
            "engine": scene.render.engine,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "resolution_percentage": scene.render.resolution_percentage,
        }

    def execute_code(self, code=None, file=None, **_ignored):
        source = code
        if file:
            path = os.path.abspath(os.path.expanduser(str(file)))
            with open(path, "r", encoding="utf-8") as handle:
                source = handle.read()
        if not source:
            raise ValueError("execute_code needs code or file")
        namespace = self.kernel.namespace
        namespace.pop("result", None)
        stdout = io.StringIO()
        stderr = io.StringIO()
        started = __import__("time").perf_counter()
        try:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exec(compile(str(source), "<opencode>", "exec"), namespace)
        except Exception as exc:
            tb = traceback.format_exc()
            raise RuntimeError(
                json.dumps(
                    {
                        "exception_type": type(exc).__name__,
                        "message": str(exc),
                        "traceback": tb,
                        "stdout": stdout.getvalue()[-8000:],
                        "stderr": stderr.getvalue()[-4000:],
                    },
                    ensure_ascii=False,
                )
            )
        elapsed = round((__import__("time").perf_counter() - started) * 1000.0, 1)
        result = namespace.get("result")
        if result is not None:
            try:
                json.dumps(result)
            except Exception:
                result = repr(result)
        return {
            "executed": True,
            "stdout": stdout.getvalue()[-20000:],
            "stderr": stderr.getvalue()[-8000:],
            "result": result,
            "ms": elapsed,
        }

    def save_snapshot(self, filepath, compress=False):
        path = os.path.abspath(os.path.expanduser(str(filepath)))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path, copy=True, compress=bool(compress))
        return {"path": path, "size": os.path.getsize(path)}

    def get_marks(self, names=None):
        marks = {}
        for name in names or []:
            obj = bpy.data.objects.get(str(name))
            if not obj:
                continue
            marks[obj.name] = {
                "location": U.vec(obj.location),
                "rotation": [float(v) for v in obj.rotation_euler],
                "scale": U.vec(obj.scale),
                "parent": obj.parent.name if obj.parent else None,
            }
        return {"marks": marks}

    def restore_marks(self, marks=None):
        restored = []
        missing = []
        for name, mark in (marks or {}).items():
            obj = bpy.data.objects.get(str(name))
            if not obj:
                missing.append(name)
                continue
            try:
                obj.location = mark.get("location", list(obj.location))
                obj.rotation_euler = mark.get("rotation", list(obj.rotation_euler))
                obj.scale = mark.get("scale", list(obj.scale))
                restored.append(name)
            except Exception:
                missing.append(name)
        return {"restored": restored, "missing": missing}
