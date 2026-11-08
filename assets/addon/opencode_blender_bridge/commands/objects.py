"""Object creation and editing commands."""

import math
import os

import bpy
from mathutils import Euler, Vector

from .. import bpy_utils as U


def _finish_primitive(obj, name=None, location=None, rotation=None, scale=None):
    if name:
        obj.name = str(name)
        if obj.data:
            obj.data.name = str(name)
    if location is not None:
        obj.location = U.parse_vec(location, [0, 0, 0])
    if rotation is not None:
        obj.rotation_euler = [U.radians(v) for v in U.parse_vec(rotation, [0, 0, 0])]
    if scale is not None:
        obj.scale = U.parse_vec(scale, [1, 1, 1])
    U.select_only([obj.name])
    return obj


class ObjectCommands:
    def add_primitive(
        self,
        kind="cube",
        name=None,
        location=None,
        rotation=None,
        scale=None,
        size=2.0,
        segments=32,
        ring_count=16,
        vertices=32,
        radius=1.0,
        depth=2.0,
    ):
        kind = str(kind or "cube").lower()
        loc = U.parse_vec(location, [0, 0, 0])
        size = float(size or 2.0)
        kwargs = {"location": loc}
        if kind in {"cube", "box"}:
            bpy.ops.mesh.primitive_cube_add(size=size, **kwargs)
        elif kind in {"plane", "grid"}:
            bpy.ops.mesh.primitive_plane_add(size=size, **kwargs)
        elif kind in {"sphere", "uv_sphere"}:
            bpy.ops.mesh.primitive_uv_sphere_add(radius=float(radius or size / 2.0), segments=int(segments), ring_count=int(ring_count), **kwargs)
        elif kind in {"ico_sphere", "icosphere"}:
            bpy.ops.mesh.primitive_ico_sphere_add(radius=float(radius or size / 2.0), subdivisions=max(1, int(segments) // 8 or 2), **kwargs)
        elif kind in {"cylinder"}:
            bpy.ops.mesh.primitive_cylinder_add(radius=float(radius or size / 2.0), depth=float(depth), vertices=int(vertices), **kwargs)
        elif kind in {"cone"}:
            bpy.ops.mesh.primitive_cone_add(radius1=float(radius or size / 2.0), radius2=0.0, depth=float(depth), vertices=int(vertices), **kwargs)
        elif kind in {"torus"}:
            bpy.ops.mesh.primitive_torus_add(location=loc, major_radius=float(radius or size / 2.0), minor_radius=float(radius or size / 2.0) * 0.25, major_segments=int(segments), minor_segments=max(3, int(ring_count) // 2))
        elif kind in {"monkey", "suzanne"}:
            bpy.ops.mesh.primitive_monkey_add(size=size, **kwargs)
        else:
            raise ValueError("Unknown primitive kind: %s" % kind)
        obj = bpy.context.view_layer.objects.active
        _finish_primitive(obj, name, location, rotation, scale)
        return {
            "name": obj.name,
            "type": obj.type,
            "location": U.vec(obj.location),
            "dimensions": U.vec(obj.dimensions),
            "polygons": len(obj.data.polygons) if obj.data else 0,
        }

    def add_empty(self, name=None, location=None, display_type="PLAIN_AXES"):
        bpy.ops.object.empty_add(type=str(display_type or "PLAIN_AXES"), location=U.parse_vec(location, [0, 0, 0]))
        obj = bpy.context.view_layer.objects.active
        if name:
            obj.name = str(name)
        return {"name": obj.name, "type": obj.type, "location": U.vec(obj.location)}

    def add_camera(self, name=None, location=None, look_at=None, lens=50.0, ortho=False, ortho_scale=10.0):
        data = bpy.data.cameras.new(str(name or "Camera"))
        data.lens = float(lens or 50.0)
        if ortho:
            data.type = "ORTHO"
            data.ortho_scale = float(ortho_scale or 10.0)
        obj = bpy.data.objects.new(str(name or "Camera"), data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = U.parse_vec(location, [7.0, -7.0, 5.0])
        target = U.parse_vec(look_at, [0, 0, 0])
        direction = Vector(target) - obj.location
        if direction.length > 1e-6:
            obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return {"name": obj.name, "location": U.vec(obj.location), "lens": data.lens, "type": data.type}

    def add_light(self, light_type="AREA", name=None, location=None, energy=1000.0, color=None, size=5.0, look_at=None, rotation=None):
        data = bpy.data.lights.new(str(name or "Light"), type=str(light_type or "AREA").upper())
        data.energy = float(energy or 1000.0)
        if color is not None:
            rgb = U.parse_vec(color, [1, 1, 1])
            data.color = rgb
        if hasattr(data, "size"):
            try:
                data.size = float(size or 5.0)
            except Exception:
                pass
        if hasattr(data, "shadow_soft_size"):
            try:
                data.shadow_soft_size = float(size or 1.0)
            except Exception:
                pass
        obj = bpy.data.objects.new(str(name or "Light"), data)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = U.parse_vec(location, [4, -4, 6])
        target = U.parse_vec(look_at, [0, 0, 0])
        direction = Vector(target) - obj.location
        if direction.length > 1e-6:
            obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        if rotation is not None:
            obj.rotation_euler = [U.radians(v) for v in U.parse_vec(rotation, [0, 0, 0])]
        return {"name": obj.name, "type": light_type, "location": U.vec(obj.location), "energy": data.energy}

    def set_transform(self, name, location=None, rotation=None, scale=None):
        obj = U.get_object(name)
        if location is not None:
            obj.location = U.parse_vec(location, list(obj.location))
        if rotation is not None:
            obj.rotation_euler = [U.radians(v) for v in U.parse_vec(rotation, [0, 0, 0])]
        if scale is not None:
            obj.scale = U.parse_vec(scale, list(obj.scale))
        return {"name": obj.name, "location": U.vec(obj.location), "rotation_degrees": [round(math.degrees(v), 4) for v in obj.rotation_euler], "scale": U.vec(obj.scale)}

    def apply_transform(self, name=None, location=False, rotation=False, scale=False):
        targets = [U.get_object(name)] if name else [o for o in bpy.context.selected_objects]
        if not targets:
            targets = [U.get_object(name)] if name else []
        if not targets:
            raise ValueError("apply_transform needs an object or a selection")
        U.select_only([o.name for o in targets])
        bpy.ops.object.transform_apply(location=bool(location), rotation=bool(rotation), scale=bool(scale))
        return {"applied": [o.name for o in targets], "location": bool(location), "rotation": bool(rotation), "scale": bool(scale)}

    def set_origin(self, name, origin_type="GEOMETRY"):
        obj = U.get_object(name)
        U.select_only([obj.name])
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.origin_set(type=str(origin_type or "GEOMETRY"), center="MEDIAN")
        return {"name": obj.name, "origin": U.vec(obj.location)}

    def delete_objects(self, names=None, all=False):
        if all:
            targets = list(bpy.context.scene.objects)
        else:
            targets = [bpy.data.objects.get(str(n)) for n in (names or [])]
            targets = [o for o in targets if o]
        if not targets:
            return {"deleted": []}
        deleted = [o.name for o in targets]
        for obj in targets:
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception:
                pass
        return {"deleted": deleted}

    def duplicate_object(self, name, offset=None, count=1):
        obj = U.get_object(name)
        offset_v = Vector(U.parse_vec(offset, [2, 0, 0]))
        copies = []
        for _ in range(max(1, int(count or 1))):
            new_obj = obj.copy()
            if obj.data:
                new_obj.data = obj.data.copy()
            bpy.context.scene.collection.objects.link(new_obj)
            new_obj.location = obj.location + offset_v
            new_obj.name = obj.name + "_copy"
            copies.append(new_obj.name)
            obj = new_obj
        return {"created": copies, "source": name}

    def join_objects(self, names, name=None):
        objs = [U.get_object(n) for n in (names or [])]
        if len(objs) < 2:
            raise ValueError("join_objects needs at least two objects")
        U.select_only([o.name for o in objs])
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        target = bpy.context.view_layer.objects.active
        if name:
            target.name = str(name)
        return {"name": target.name, "polygons": len(target.data.polygons) if target.data else 0}

    def rename_object(self, name, new_name):
        obj = U.get_object(name)
        old = obj.name
        obj.name = str(new_name)
        if obj.data and getattr(obj.data, "name", None) == old:
            obj.data.name = str(new_name)
        return {"old": old, "name": obj.name}

    def set_parent(self, child, parent=None, keep_transform=True):
        obj = U.get_object(child)
        world = obj.matrix_world.copy()
        if parent:
            par = U.get_object(parent)
            obj.parent = par
            if keep_transform:
                obj.matrix_parent_inverse = par.matrix_world.inverted()
        else:
            obj.parent = None
        if keep_transform:
            obj.matrix_world = world
        return {"child": obj.name, "parent": obj.parent.name if obj.parent else None}

    def shade_smooth(self, name, smooth=True):
        obj = U.get_object(name)
        if obj.type != "MESH" or not obj.data:
            raise ValueError("shade_smooth needs a mesh object")
        for poly in obj.data.polygons:
            poly.use_smooth = bool(smooth)
        return {"name": obj.name, "smooth": bool(smooth), "polygons": len(obj.data.polygons)}

    def add_modifier(self, name, modifier_type="SUBSURF", params=None):
        obj = U.get_object(name)
        mod = obj.modifiers.new(str(modifier_type or "SUBSURF"), str(modifier_type or "SUBSURF").upper())
        for key, value in (params or {}).items():
            try:
                setattr(mod, str(key), value)
            except Exception:
                pass
        return {"name": obj.name, "modifier": mod.name, "type": mod.type}

    def apply_modifier(self, name, modifier=None):
        obj = U.get_object(name)
        U.select_only([obj.name])
        bpy.context.view_layer.objects.active = obj
        if modifier:
            bpy.ops.object.modifier_apply(modifier=str(modifier))
            return {"name": obj.name, "applied": [str(modifier)]}
        applied = []
        for mod in list(obj.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
                applied.append(mod.name)
            except Exception:
                pass
        return {"name": obj.name, "applied": applied}

    def convert_to_mesh(self, name):
        obj = U.get_object(name)
        U.select_only([obj.name])
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target="MESH")
        return {"name": obj.name, "type": obj.type, "polygons": len(obj.data.polygons) if obj.data else 0}

    def import_file(self, filepath):
        path = os.path.abspath(os.path.expanduser(str(filepath)))
        if not os.path.exists(path):
            raise ValueError("File not found: %s" % path)
        ext = os.path.splitext(path)[1].lower()
        before = set(bpy.data.objects.keys())
        if ext in {".glb", ".gltf"}:
            bpy.ops.import_scene.gltf(filepath=path)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=path)
        elif ext == ".obj":
            bpy.ops.wm.obj_import(filepath=path)
        elif ext == ".stl":
            bpy.ops.wm.stl_import(filepath=path)
        elif ext == ".blend":
            raise ValueError("Use open_blend to load a .blend file; import_file handles meshes only")
        elif ext in {".ply"}:
            bpy.ops.wm.ply_import(filepath=path)
        else:
            raise ValueError("Unsupported import format: %s" % ext)
        added = [name for name in bpy.data.objects.keys() if name not in before]
        return {"filepath": path, "imported": added, "count": len(added)}
