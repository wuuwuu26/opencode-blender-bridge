"""Scene audit, measurement and performance helpers."""

import bpy
from mathutils import Vector

from .. import bpy_utils as U


def _mesh_volume(obj):
    try:
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(obj.data)
        volume = abs(bm.calc_volume(signed=False))
        bm.free()
        return volume
    except Exception:
        return None


class AuditCommands:
    def audit_scene(self, limit=200, max_polygons=2000000):
        issues = []
        checked = 0
        total_polygons = 0
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH" or not obj.data:
                continue
            checked += 1
            mesh = obj.data
            total_polygons += len(mesh.polygons)
            if total_polygons > int(max_polygons or 2000000):
                issues.append({"object": obj.name, "issue": "audit_stopped", "detail": "polygon budget reached"})
                break
            if len(mesh.polygons) == 0:
                issues.append({"object": obj.name, "issue": "empty_mesh", "detail": "no polygons"})
            if not U.material_names(obj):
                issues.append({"object": obj.name, "issue": "missing_material", "detail": "no material slot"})
            try:
                if any(abs(v - 1.0) > 0.001 for v in obj.scale):
                    issues.append(
                        {
                            "object": obj.name,
                            "issue": "unapplied_scale",
                            "detail": "scale=%s" % U.vec(obj.scale),
                        }
                    )
                if obj.scale.x * obj.scale.y * obj.scale.z <= 0:
                    issues.append({"object": obj.name, "issue": "negative_scale", "detail": "mirrored object"})
            except Exception:
                pass
            degenerate = 0
            for poly in mesh.polygons:
                if poly.area < 1e-10:
                    degenerate += 1
            if degenerate:
                issues.append({"object": obj.name, "issue": "degenerate_faces", "detail": "%d zero-area faces" % degenerate})
            if len(issues) > int(limit or 200):
                break
        return {
            "objects_checked": checked,
            "issues": issues[: int(limit or 200)],
            "issue_count": len(issues),
            "truncated": len(issues) > int(limit or 200),
        }

    def measure_object(self, name):
        obj = U.get_object(name)
        lo, hi = U.world_bbox(obj)
        size = hi - lo
        info = {
            "name": obj.name,
            "type": obj.type,
            "dimensions": U.vec(obj.dimensions),
            "bbox": {"min": U.vec(lo), "max": U.vec(hi), "size": U.vec(size), "volume": round(size.x * size.y * size.z, 6)},
            "location": U.vec(obj.location),
        }
        if obj.type == "MESH" and obj.data:
            info["triangles"] = sum(max(1, len(p.vertices) - 2) for p in obj.data.polygons)
            info["surface_area"] = round(sum(float(p.area) for p in obj.data.polygons), 6)
            info["mesh_volume"] = _mesh_volume(obj)
            info["non_manifold_edges"] = self._non_manifold_count(obj)
        return info

    def _non_manifold_count(self, obj):
        try:
            import bmesh

            bm = bmesh.new()
            bm.from_mesh(obj.data)
            count = sum(1 for edge in bm.edges if not edge.is_manifold)
            bm.free()
            return count
        except Exception:
            return None

    def find_merge_candidates(self, max_groups=20, min_gap=0.02):
        scene_lo, scene_hi, scene_radius = U.scene_bbox()
        gap_limit = max(float(min_gap or 0.02) * max(scene_radius, 1.0), 0.001)
        groups = {}
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH" or not obj.data:
                continue
            if obj.modifiers or obj.parent:
                continue
            key = (tuple(sorted(U.material_names(obj))), obj.type)
            groups.setdefault(key, []).append(obj)
        candidates = []
        for (materials, _type), objs in groups.items():
            if len(objs) < 2:
                continue
            boxes = []
            for obj in objs:
                lo, hi = U.world_bbox(obj)
                boxes.append((obj, lo, hi))
            # Split into clusters where neighbours are within gap_limit.
            clusters = []
            for item in boxes:
                placed = False
                for cluster in clusters:
                    if self._near(item[1], item[2], cluster[0][1], cluster[0][2], gap_limit):
                        cluster.append(item)
                        placed = True
                        break
                if not placed:
                    clusters.append([item])
            for cluster in clusters:
                if len(cluster) < 2:
                    continue
                names = [item[0].name for item in cluster]
                polygons = sum(len(item[0].data.polygons) for item in cluster)
                candidates.append(
                    {
                        "objects": names,
                        "materials": list(materials),
                        "polygons": polygons,
                        "reason": "same materials, adjacent, no modifiers or parents",
                        "safe": polygons < 200000,
                    }
                )
            if len(candidates) >= int(max_groups or 20):
                break
        candidates.sort(key=lambda c: c["polygons"])
        return {"candidates": candidates[: int(max_groups or 20)], "count": len(candidates)}

    @staticmethod
    def _near(lo_a, hi_a, lo_b, hi_b, gap):
        dx = max(lo_a.x - hi_b.x, lo_b.x - hi_a.x, 0.0)
        dy = max(lo_a.y - hi_b.y, lo_b.y - hi_a.y, 0.0)
        dz = max(lo_a.z - hi_b.z, lo_b.z - hi_a.z, 0.0)
        return Vector((dx, dy, dz)).length <= gap

    def get_perf_report(self):
        scene = bpy.context.scene
        render = scene.render
        total_polys = 0
        modifier_count = 0
        for obj in scene.objects:
            if obj.type == "MESH" and obj.data:
                total_polys += len(obj.data.polygons)
            modifier_count += len(obj.modifiers)
        recommendations = []
        if render.engine == "CYCLES":
            samples = int(getattr(scene.cycles, "samples", 0) or 0)
            if samples > 128:
                recommendations.append("Cycles samples=%d; 32-64 is enough for review frames" % samples)
            if total_polys > 1000000:
                recommendations.append("High polygon count; enable Simplify or use linked duplicates")
        if render.resolution_percentage > 100:
            recommendations.append("resolution_percentage > 100 wastes time for previews")
        if render.resolution_x * render.resolution_y > 2560 * 1440:
            recommendations.append("Render resolution is large; half resolution is usually enough for review")
        if len(bpy.data.images) > 200:
            recommendations.append("Many images in file (%d); purge unused to reduce memory" % len(bpy.data.images))
        if modifier_count > 50:
            recommendations.append("Many modifiers (%d); apply or remove unused ones" % modifier_count)
        if not recommendations:
            recommendations.append("No obvious performance problems found")
        return {
            "engine": render.engine,
            "resolution": [render.resolution_x, render.resolution_y],
            "resolution_percentage": render.resolution_percentage,
            "samples": int(getattr(scene.cycles, "samples", 0)) if render.engine == "CYCLES" else None,
            "objects": len(scene.objects),
            "polygons": total_polys,
            "modifiers": modifier_count,
            "materials": len(bpy.data.materials),
            "images": len(bpy.data.images),
            "recommendations": recommendations,
        }

    def apply_perf_settings(self, profile="fast", engine=None):
        scene = bpy.context.scene
        render = scene.render
        if engine:
            from .scene import _engine_name

            resolved = _engine_name(engine)
            if resolved:
                render.engine = resolved
        profiles = {
            "fast": {"pct": 50, "samples": 24, "transparent": False},
            "balanced": {"pct": 75, "samples": 64, "transparent": False},
            "quality": {"pct": 100, "samples": 256, "transparent": False},
        }
        cfg = profiles.get(str(profile or "fast").lower(), profiles["fast"])
        render.resolution_percentage = cfg["pct"]
        try:
            if render.engine == "CYCLES":
                scene.cycles.samples = cfg["samples"]
                scene.cycles.use_denoising = True
            elif hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
                scene.eevee.taa_render_samples = cfg["samples"]
        except Exception:
            pass
        return {"profile": str(profile or "fast"), "settings": self.get_perf_report()}
