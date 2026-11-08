"""Scene, render, file and collection commands."""

import os
import time

import bpy

from .. import bpy_utils as U


def _engine_name(name):
    wanted = str(name or "").lower()
    if not wanted:
        return None
    aliases = {
        "eevee": ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"],
        "eevee_next": ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"],
        "cycles": ["CYCLES"],
        "workbench": ["BLENDER_WORKBENCH"],
    }
    candidates = aliases.get(wanted, [str(name).upper()])
    available = set()
    try:
        available = {item.identifier for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items}
    except Exception:
        pass
    for candidate in candidates:
        if not available or candidate in available:
            return candidate
    return candidates[0]


def _samples(scene):
    try:
        if scene.render.engine == "CYCLES":
            return int(scene.cycles.samples)
        if hasattr(scene, "eevee"):
            if hasattr(scene.eevee, "taa_render_samples"):
                return int(scene.eevee.taa_render_samples)
        return None
    except Exception:
        return None


class SceneCommands:
    def set_frame(self, frame):
        scene = bpy.context.scene
        scene.frame_set(int(frame))
        return {"frame": scene.frame_current}

    def get_frame(self):
        scene = bpy.context.scene
        return {
            "frame": scene.frame_current,
            "start": scene.frame_start,
            "end": scene.frame_end,
            "fps": scene.render.fps,
        }

    def get_render_settings(self):
        scene = bpy.context.scene
        render = scene.render
        return {
            "engine": render.engine,
            "resolution": [render.resolution_x, render.resolution_y],
            "resolution_percentage": render.resolution_percentage,
            "samples": _samples(scene),
            "filepath": render.filepath,
            "film_transparent": bool(render.film_transparent),
            "fps": render.fps,
            "frame": scene.frame_current,
            "camera": scene.camera.name if scene.camera else None,
            "color_management": render.image_settings.color_mode,
        }

    def set_render_settings(
        self,
        engine=None,
        resolution_x=None,
        resolution_y=None,
        resolution_percentage=None,
        samples=None,
        filepath=None,
        film_transparent=None,
        fps=None,
    ):
        scene = bpy.context.scene
        render = scene.render
        if engine:
            resolved = _engine_name(engine)
            if resolved:
                render.engine = resolved
        if resolution_x:
            render.resolution_x = int(resolution_x)
        if resolution_y:
            render.resolution_y = int(resolution_y)
        if resolution_percentage:
            render.resolution_percentage = int(resolution_percentage)
        if samples is not None:
            try:
                if render.engine == "CYCLES":
                    scene.cycles.samples = int(samples)
                elif hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
                    scene.eevee.taa_render_samples = int(samples)
            except Exception:
                pass
        if filepath:
            render.filepath = str(filepath)
        if film_transparent is not None:
            render.film_transparent = bool(film_transparent)
        if fps:
            render.fps = int(fps)
        return self.get_render_settings()

    def set_camera(self, name):
        obj = U.get_object(name)
        if obj.type != "CAMERA":
            raise ValueError("Not a camera: %s" % name)
        bpy.context.scene.camera = obj
        return {"camera": obj.name}

    def render_still(self, filepath=None, camera=None, engine=None, samples=None, resolution_x=None, resolution_y=None, frame=None):
        scene = bpy.context.scene
        render = scene.render
        if camera:
            cam = U.get_object(camera)
            if cam.type != "CAMERA":
                raise ValueError("Not a camera: %s" % camera)
            scene.camera = cam
        if scene.camera is None:
            raise ValueError("Scene has no camera; create one with add_camera or pass camera=")
        if frame is not None:
            scene.frame_set(int(frame))
        if engine:
            resolved = _engine_name(engine)
            if resolved:
                render.engine = resolved
        if resolution_x:
            render.resolution_x = int(resolution_x)
        if resolution_y:
            render.resolution_y = int(resolution_y)
        if samples is not None:
            try:
                if render.engine == "CYCLES":
                    scene.cycles.samples = int(samples)
                elif hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
                    scene.eevee.taa_render_samples = int(samples)
            except Exception:
                pass
        if not filepath:
            base = os.path.join(bpy.app.tempdir or os.getcwd(), "ocbb_render_%d.png" % int(time.time() * 1000))
            filepath = base
        path = os.path.abspath(os.path.expanduser(str(filepath)))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        ext = os.path.splitext(path)[1].lower()
        fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP", ".exr": "OPEN_EXR", ".tif": "TIFF", ".tiff": "TIFF"}.get(ext, "PNG")
        render.image_settings.file_format = fmt
        previous = render.filepath
        render.filepath = path
        started = time.time()
        try:
            bpy.ops.render.render(write_still=True)
        finally:
            render.filepath = previous
        return {
            "filepath": path,
            "width": render.resolution_x,
            "height": render.resolution_y,
            "engine": render.engine,
            "samples": _samples(scene),
            "ms": round((time.time() - started) * 1000),
        }

    def export_scene(self, filepath, format=None, selected_only=False):
        path = os.path.abspath(os.path.expanduser(str(filepath)))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fmt = str(format or os.path.splitext(path)[1].lstrip(".") or "glb").lower()
        if selected_only and not bpy.context.selected_objects:
            raise ValueError("selected_only=True but nothing is selected")
        if fmt in {"glb", "gltf"}:
            kwargs = {
                "filepath": path,
                "export_format": "GLB" if fmt == "glb" else "GLTF_SEPARATE",
            }
            try:
                bpy.ops.export_scene.gltf(use_selection=bool(selected_only), **kwargs)
            except TypeError:
                bpy.ops.export_scene.gltf(**kwargs)
        elif fmt == "fbx":
            bpy.ops.export_scene.fbx(filepath=path, use_selection=bool(selected_only))
        elif fmt == "obj":
            args = {"filepath": path}
            try:
                bpy.ops.wm.obj_export(export_selected_objects=bool(selected_only), **args)
            except TypeError:
                bpy.ops.wm.obj_export(**args)
        elif fmt == "stl":
            args = {"filepath": path}
            try:
                bpy.ops.wm.stl_export(export_selected_objects=bool(selected_only), **args)
            except TypeError:
                bpy.ops.wm.stl_export(**args)
        elif fmt in {"usd", "usda", "usdc", "usdz"}:
            bpy.ops.wm.usd_export(filepath=path, selected_objects_only=bool(selected_only))
        elif fmt in {"blend", "blendfile"}:
            bpy.ops.wm.save_as_mainfile(filepath=path, copy=True)
        else:
            raise ValueError("Unsupported export format: %s" % fmt)
        size = os.path.getsize(path) if os.path.exists(path) else None
        return {"filepath": path, "format": fmt, "bytes": size, "selected_only": bool(selected_only)}

    def save_blend(self, filepath=None):
        if filepath:
            path = os.path.abspath(os.path.expanduser(str(filepath)))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=path)
            return {"filepath": path}
        bpy.ops.wm.save_mainfile()
        return {"filepath": bpy.data.filepath}

    def open_blend(self, filepath):
        path = os.path.abspath(os.path.expanduser(str(filepath)))
        if not os.path.exists(path):
            raise ValueError("File not found: %s" % path)
        bpy.ops.wm.open_mainfile(filepath=path)
        return {"filepath": bpy.data.filepath, "scene": bpy.context.scene.name}

    def list_collections(self):
        result = []

        def walk(layer_collection, depth=0):
            name = layer_collection.collection.name
            result.append(
                {
                    "name": name,
                    "depth": depth,
                    "objects": len(layer_collection.collection.objects),
                    "children": len(layer_collection.children),
                }
            )
            for child in layer_collection.children:
                walk(child, depth + 1)

        walk(bpy.context.view_layer.layer_collection)
        return {"collections": result, "count": len(result)}

    def create_collection(self, name, parent=None):
        coll = bpy.data.collections.get(str(name)) or bpy.data.collections.new(str(name))
        parent_coll = bpy.data.collections.get(str(parent)) if parent else bpy.context.scene.collection
        if coll.name not in parent_coll.children:
            try:
                parent_coll.children.link(coll)
            except Exception:
                pass
        return {"name": coll.name, "parent": parent_coll.name, "objects": len(coll.objects)}

    def link_to_collection(self, name, collection):
        obj = U.get_object(name)
        coll = bpy.data.collections.get(str(collection))
        if coll is None:
            raise ValueError("Collection not found: %s" % collection)
        if obj.name not in coll.objects:
            coll.objects.link(obj)
        return {"object": obj.name, "collection": coll.name, "collections": [c.name for c in obj.users_collection]}

    def set_world(self, color=None, strength=None, background=None):
        scene = bpy.context.scene
        world = scene.world
        if world is None:
            world = bpy.data.worlds.new("World")
            scene.world = world
        world.use_nodes = True
        bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
        if bg is None:
            return {"world": world.name, "changed": False}
        if color is not None:
            rgb = U.parse_vec(color, [0.05, 0.05, 0.05])
            bg.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        if background is not None:
            rgb = U.parse_vec(background, [0.05, 0.05, 0.05])
            bg.inputs["Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        if strength is not None:
            bg.inputs["Strength"].default_value = float(strength)
        return {
            "world": world.name,
            "color": [round(float(v), 4) for v in bg.inputs["Color"].default_value],
            "strength": round(float(bg.inputs["Strength"].default_value), 4),
        }
