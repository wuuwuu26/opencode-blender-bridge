"""Material commands."""

import bpy

from .. import bpy_utils as U


def _principled(mat):
    if not mat.use_nodes:
        mat.use_nodes = True
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def _set_input(node, names, value):
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            try:
                socket.default_value = value
                return True
            except Exception:
                pass
    return False


def _color(value, default=(0.8, 0.8, 0.8, 1.0)):
    if value is None:
        return default
    if isinstance(value, str):
        text = value.strip().lstrip("#")
        if len(text) in {6, 8}:
            try:
                nums = [int(text[i : i + 2], 16) / 255.0 for i in range(0, len(text), 2)]
                if len(nums) == 3:
                    nums.append(1.0)
                return tuple(nums)
            except Exception:
                pass
    try:
        nums = list(value)
    except Exception:
        return default
    if len(nums) == 3:
        nums.append(1.0)
    return tuple(float(n) for n in nums[:4])


class MaterialCommands:
    def list_materials(self):
        result = []
        for mat in bpy.data.materials:
            entry = {"name": mat.name, "users": mat.users, "use_nodes": bool(mat.use_nodes)}
            if mat.use_nodes:
                node = _principled(mat)
                if node:
                    base = node.inputs.get("Base Color")
                    rough = node.inputs.get("Roughness")
                    metal = node.inputs.get("Metallic")
                    entry["base_color"] = [round(float(v), 4) for v in base.default_value] if base else None
                    entry["roughness"] = round(float(rough.default_value), 4) if rough else None
                    entry["metallic"] = round(float(metal.default_value), 4) if metal else None
            result.append(entry)
        return {"materials": result, "count": len(result)}

    def create_material(
        self,
        name="Material",
        base_color=None,
        metallic=0.0,
        roughness=0.5,
        emission=None,
        emission_strength=0.0,
        alpha=1.0,
    ):
        mat = bpy.data.materials.get(str(name)) or bpy.data.materials.new(str(name))
        mat.use_nodes = True
        color = _color(base_color)
        mat.diffuse_color = color
        node = _principled(mat)
        if node:
            _set_input(node, ["Base Color"], color)
            _set_input(node, ["Metallic"], float(metallic or 0.0))
            _set_input(node, ["Roughness"], float(roughness if roughness is not None else 0.5))
            _set_input(node, ["Alpha"], float(alpha if alpha is not None else 1.0))
            if emission is not None:
                _set_input(node, ["Emission Color", "Emission"], _color(emission))
                _set_input(node, ["Emission Strength"], float(emission_strength or 1.0))
        if float(alpha if alpha is not None else 1.0) < 1.0:
            try:
                mat.blend_method = "BLEND"
            except Exception:
                pass
        return {
            "name": mat.name,
            "base_color": list(color),
            "metallic": float(metallic or 0.0),
            "roughness": float(roughness if roughness is not None else 0.5),
        }

    def assign_material(self, name, material, slot=None):
        obj = U.get_object(name)
        mat = bpy.data.materials.get(str(material))
        if mat is None:
            mat = bpy.data.materials.new(str(material))
            mat.use_nodes = True
        if slot is not None:
            index = int(slot)
            while len(obj.material_slots) <= index:
                obj.data.materials.append(None)
            obj.data.materials[index] = mat
        elif obj.data and hasattr(obj.data, "materials"):
            if len(obj.data.materials) == 0:
                obj.data.materials.append(mat)
            else:
                obj.data.materials[0] = mat
        else:
            raise ValueError("Object cannot take materials: %s" % obj.name)
        return {"object": obj.name, "material": mat.name, "slots": [s.material.name if s.material else None for s in obj.material_slots]}

    def set_material_property(self, material, property, value):
        mat = bpy.data.materials.get(str(material))
        if mat is None:
            raise ValueError("Material not found: %s" % material)
        node = _principled(mat)
        if node is None:
            raise ValueError("Material has no Principled BSDF: %s" % material)
        prop = str(property)
        mapping = {
            "base_color": ["Base Color"],
            "color": ["Base Color"],
            "metallic": ["Metallic"],
            "roughness": ["Roughness"],
            "alpha": ["Alpha"],
            "emission": ["Emission Color", "Emission"],
            "emission_strength": ["Emission Strength"],
            "ior": ["IOR"],
            "transmission": ["Transmission Weight", "Transmission"],
            "coat": ["Coat Weight", "Clearcoat"],
        }
        names = mapping.get(prop, [prop])
        if prop in {"base_color", "color", "emission"}:
            value = _color(value)
        elif isinstance(value, (int, float)):
            value = float(value)
        ok = _set_input(node, names, value)
        if not ok:
            raise ValueError("Unknown material property: %s" % property)
        if prop in {"base_color", "color"}:
            mat.diffuse_color = _color(value)
        return {"material": mat.name, "property": prop, "value": value if not isinstance(value, tuple) else list(value)}

    def remove_material(self, material):
        mat = bpy.data.materials.get(str(material))
        if mat is None:
            return {"removed": None}
        name = mat.name
        bpy.data.materials.remove(mat)
        return {"removed": name}
