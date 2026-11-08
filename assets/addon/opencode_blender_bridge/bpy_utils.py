"""Small bpy helpers shared by command modules."""

import math

import bpy
from mathutils import Vector


def vec(v):
    return [round(float(v[0]), 6), round(float(v[1]), 6), round(float(v[2]), 6)]


def deselect_all():
    try:
        for obj in bpy.context.view_layer.objects:
            obj.select_set(False)
    except Exception:
        pass


def select_only(names):
    if isinstance(names, str):
        names = [names]
    deselect_all()
    found = []
    for name in names or []:
        obj = bpy.data.objects.get(str(name))
        if obj is None:
            continue
        try:
            obj.select_set(True)
        except Exception:
            pass
        found.append(obj)
    if found:
        try:
            bpy.context.view_layer.objects.active = found[0]
        except Exception:
            pass
    return found


def get_object(name):
    obj = bpy.data.objects.get(str(name or ""))
    if obj is None:
        raise ValueError("Object not found: %s" % name)
    return obj


def world_bbox(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return lo, hi


def scene_bbox(objects=None):
    objs = [o for o in (objects if objects is not None else bpy.context.scene.objects) if o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT"}]
    if not objs:
        return Vector((0, 0, 0)), Vector((0, 0, 0)), 0.0
    los, his = [], []
    for obj in objs:
        try:
            lo, hi = world_bbox(obj)
        except Exception:
            continue
        los.append(lo)
        his.append(hi)
    if not los:
        return Vector((0, 0, 0)), Vector((0, 0, 0)), 0.0
    lo = Vector((min(v.x for v in los), min(v.y for v in los), min(v.z for v in los)))
    hi = Vector((max(v.x for v in his), max(v.y for v in his), max(v.z for v in his)))
    radius = max((hi - lo).length / 2.0, 0.001)
    return lo, hi, radius


def radians(value):
    try:
        return math.radians(float(value))
    except Exception:
        return 0.0


def parse_vec(value, default=None):
    if value is None:
        return default
    if isinstance(value, (list, tuple)):
        if len(value) >= 3:
            return [float(value[0]), float(value[1]), float(value[2])]
        return list(default or [0, 0, 0])
    text = str(value).strip().strip("()[]")
    parts = [p.strip() for p in text.replace(" ", ",").split(",") if p.strip()]
    try:
        nums = [float(p) for p in parts]
    except Exception:
        return default
    if len(nums) < 3:
        nums += [0.0] * (3 - len(nums))
    return nums[:3]


def parse_size(value, default=(960, 540)):
    if not value:
        return default
    text = str(value).lower().replace(" ", "")
    if "x" in text:
        a, b = text.split("x", 1)
        try:
            return max(1, int(float(a))), max(1, int(float(b)))
        except Exception:
            return default
    try:
        n = int(float(text))
        return max(1, n), max(1, n)
    except Exception:
        return default


def material_names(obj):
    names = []
    for slot in getattr(obj, "material_slots", []) or []:
        if slot.material:
            names.append(slot.material.name)
    return names
