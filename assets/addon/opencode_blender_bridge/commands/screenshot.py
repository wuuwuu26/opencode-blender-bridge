"""Viewport / camera screenshots for the agent's eyes."""

import math
import os
import time

import bpy
from mathutils import Vector

from .. import bpy_utils as U


def _resolve_path(filepath, format="png"):
    if filepath:
        path = os.path.abspath(os.path.expanduser(str(filepath)))
    else:
        path = os.path.join(bpy.app.tempdir or os.getcwd(), "ocbb_frame_%d.%s" % (int(time.time() * 1000), format or "png"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def _frame_camera(scene, location=None, look_at=None, lens=50.0, ortho=False, ortho_scale=10.0):
    data = bpy.data.cameras.new("__ocbb_cam__")
    data.lens = float(lens or 50.0)
    data.clip_start = 0.01
    if ortho:
        data.type = "ORTHO"
        data.ortho_scale = float(ortho_scale or 10.0)
    obj = bpy.data.objects.new("__ocbb_cam__", data)
    scene.collection.objects.link(obj)
    lo, hi, radius = U.scene_bbox()
    center = (lo + hi) / 2.0 if radius else Vector((0, 0, 0))
    if location is None:
        direction = Vector((1.0, -1.4, 0.8)).normalized()
        distance = max(radius * 3.2, 2.0)
        obj.location = center + direction * distance
    else:
        obj.location = Vector(U.parse_vec(location, [7, -7, 5]))
    target = Vector(U.parse_vec(look_at, list(center))) if look_at is not None else center
    direction = target - obj.location
    if direction.length < 1e-6:
        direction = Vector((0, 0, -1))
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    data.clip_end = max(1000.0, (obj.location - center).length + radius * 20.0)
    if ortho and ortho_scale is None:
        data.ortho_scale = max(radius * 2.4, 0.1)
    if not ortho:
        try:
            data.sensor_fit = "AUTO"
        except Exception:
            pass
    return obj


class ScreenshotCommands:
    def get_viewport_screenshot(self, max_size=800, filepath=None, format="png"):
        path = _resolve_path(filepath, format)
        if bpy.app.background:
            return self.render_view(max_size=max_size, filepath=path, format=format)
        try:
            area = None
            region = None
            space = None
            for window in bpy.context.window_manager.windows:
                for candidate in window.screen.areas:
                    if candidate.type == "VIEW_3D":
                        area = candidate
                        space = candidate.spaces.active
                        region = next((r for r in candidate.regions if r.type == "WINDOW"), None)
                        break
                if area:
                    break
            if not area or region is None or space is None:
                return self.render_view(max_size=max_size, filepath=path, format=format)
            try:
                import gpu
                import numpy as np

                r3d = space.region_3d
                src_w, src_h = region.width, region.height
                scale = min(1.0, float(max_size or 800) / float(max(src_w, src_h) or 1))
                width = max(1, int(src_w * scale))
                height = max(1, int(src_h * scale))
                offscreen = gpu.types.GPUOffScreen(width, height)
                try:
                    try:
                        offscreen.draw_view3d(
                            bpy.context.scene,
                            bpy.context.view_layer,
                            space,
                            region,
                            r3d.view_matrix,
                            r3d.window_matrix,
                            do_color_management=True,
                        )
                    except TypeError:
                        offscreen.draw_view3d(
                            bpy.context.scene,
                            bpy.context.view_layer,
                            space,
                            region,
                            r3d.view_matrix,
                            r3d.window_matrix,
                        )
                    buffer = offscreen.texture_color.read()
                finally:
                    offscreen.free()
                buffer.dimensions = width * height * 4
                pixels = np.asarray(buffer, dtype=np.float32) / 255.0
                image = bpy.data.images.new("__ocbb_viewport__", width, height, alpha=True)
                image.pixels.foreach_set(pixels.ravel())
                image.filepath_raw = path
                image.file_format = str(format or "png").upper()
                image.save()
                bpy.data.images.remove(image)
                return {"success": True, "width": width, "height": height, "filepath": path, "method": "offscreen"}
            except Exception as exc:
                print("[OpenCode Bridge] offscreen viewport capture failed (%s); falling back to camera render" % exc, flush=True)
                return self.render_view(max_size=max_size, filepath=path, format=format)
        except Exception as exc:
            return {"error": str(exc)}

    def screenshot_area(self, filepath=None, area=0, max_size=1200):
        path = _resolve_path(filepath, "png")
        if bpy.app.background:
            return {"error": "screenshot_area is not available in background mode"}
        windows = list(bpy.context.window_manager.windows)
        if not windows:
            return {"error": "No Blender window"}
        areas = list(windows[0].screen.areas)
        try:
            target = areas[int(area or 0)]
        except Exception:
            return {"error": "No area with index %s (found %d)" % (area, len(areas))}
        with bpy.context.temp_override(area=target):
            bpy.ops.screen.screenshot_area(filepath=path)
        try:
            img = bpy.data.images.load(path)
            width, height = img.size
            if max_size and max(width, height) > int(max_size):
                scale = float(max_size) / float(max(width, height))
                width, height = int(width * scale), int(height * scale)
                img.scale(width, height)
                img.file_format = "PNG"
                img.save()
            bpy.data.images.remove(img)
        except Exception:
            width = height = None
        return {"success": True, "filepath": path, "width": width, "height": height, "method": "screen_area", "area_type": target.type}

    def render_view(
        self,
        max_size=800,
        filepath=None,
        format="png",
        from_location=None,
        look_at=None,
        lens=50.0,
        ortho=False,
        ortho_scale=10.0,
        view_size=None,
        shading=None,
        view_mode="viewport",
        **kwargs,
    ):
        # Accept `from` as an alias because it is a Python keyword on the wire.
        if from_location is None:
            from_location = kwargs.get("from") or kwargs.get("from_")
        path = _resolve_path(filepath, format)
        scene = bpy.context.scene
        render = scene.render
        previous = {
            "engine": render.engine,
            "x": render.resolution_x,
            "y": render.resolution_y,
            "pct": render.resolution_percentage,
            "filepath": render.filepath,
            "format": render.image_settings.file_format,
            "camera": scene.camera,
            "film_transparent": render.film_transparent,
        }
        display = None
        try:
            display = scene.display.shading
            previous_display = {
                "light": display.light,
                "color_type": display.color_type,
                "show_cavity": display.show_cavity,
                "show_shadows": display.show_shadows,
            }
        except Exception:
            previous_display = None

        temp_camera = None
        try:
            if from_location is not None or look_at is not None or scene.camera is None:
                temp_camera = _frame_camera(
                    scene,
                    location=from_location,
                    look_at=look_at,
                    lens=lens,
                    ortho=ortho,
                    ortho_scale=ortho_scale if ortho_scale else None,
                )
                scene.camera = temp_camera
            if view_size:
                width, height = U.parse_size(view_size, (int(max_size or 800), int(float(max_size or 800) * 9 / 16)))
            else:
                limit = int(max_size or 800)
                width, height = limit, max(1, int(limit * 9 / 16))
            render.resolution_x = max(1, int(width))
            render.resolution_y = max(1, int(height))
            render.resolution_percentage = 100
            engine = "BLENDER_WORKBENCH"
            if str(view_mode).lower() == "render" and previous["engine"] != "BLENDER_WORKBENCH":
                engine = previous["engine"]
            render.engine = engine
            if engine == "BLENDER_WORKBENCH":
                try:
                    display.light = "STUDIO"
                    display.color_type = "MATERIAL"
                    display.show_cavity = True
                    display.show_shadows = False
                except Exception:
                    pass
            ext = os.path.splitext(path)[1].lower()
            render.image_settings.file_format = {".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}.get(ext, "PNG")
            render.filepath = path
            started = time.time()
            method = "workbench" if engine == "BLENDER_WORKBENCH" else "engine"
            try:
                bpy.ops.render.render(write_still=True)
            except Exception as workbench_error:
                if engine != "BLENDER_WORKBENCH":
                    raise
                print("[OpenCode Bridge] Workbench render failed (%s); retrying with Cycles CPU" % workbench_error, flush=True)
                render.engine = "CYCLES"
                try:
                    scene.cycles.samples = 16
                    scene.cycles.device = "CPU"
                except Exception:
                    pass
                method = "cycles"
                bpy.ops.render.render(write_still=True)
            if not os.path.exists(path):
                raise RuntimeError("Render produced no file: %s" % path)
            return {
                "success": True,
                "filepath": path,
                "width": render.resolution_x,
                "height": render.resolution_y,
                "engine": render.engine,
                "method": method,
                "from": U.vec(from_location) if from_location else None,
                "look_at": U.vec(look_at) if look_at else None,
                "ms": round((time.time() - started) * 1000),
            }
        finally:
            try:
                render.engine = previous["engine"]
                render.resolution_x = previous["x"]
                render.resolution_y = previous["y"]
                render.resolution_percentage = previous["pct"]
                render.filepath = previous["filepath"]
                render.image_settings.file_format = previous["format"]
                render.film_transparent = previous["film_transparent"]
                scene.camera = previous["camera"]
            except Exception:
                pass
            if previous_display is not None:
                try:
                    display.light = previous_display["light"]
                    display.color_type = previous_display["color_type"]
                    display.show_cavity = previous_display["show_cavity"]
                    display.show_shadows = previous_display["show_shadows"]
                except Exception:
                    pass
            if temp_camera is not None:
                try:
                    bpy.data.objects.remove(temp_camera, do_unlink=True)
                except Exception:
                    pass
