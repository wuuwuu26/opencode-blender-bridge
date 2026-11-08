import json
import sys

from client import call

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 51234

steps = [
    ("ping", {}),
    ("get_addon_info", {}),
    ("add_primitive", {"kind": "cube", "name": "TestCube", "location": [0, 0, 1], "scale": [1.2, 1.2, 1.2]}),
    ("create_material", {"name": "RedMat", "base_color": [0.8, 0.1, 0.1], "roughness": 0.3}),
    ("assign_material", {"name": "TestCube", "material": "RedMat"}),
    ("get_scene_stats", {}),
    ("measure_object", {"name": "TestCube"}),
    ("audit_scene", {}),
    ("execute_code", {"code": "print('hello from blender', bpy.app.version_string)\nresult = {'ok': True}\n"}),
    ("render_view", {"max_size": 480, "filepath": "tests/frame.png", "from_location": [6, -6, 4], "look_at": [0, 0, 1]}),
    ("get_viewport_screenshot", {"max_size": 480, "filepath": "tests/viewport.png"}),
    ("set_render_settings", {"engine": "cycles", "samples": 8, "resolution_x": 320, "resolution_y": 240}),
    ("render_still", {"filepath": "tests/render.png"}),
    ("export_scene", {"filepath": "tests/testcube.glb"}),
    ("save_snapshot", {"filepath": "tests/snapshot.blend"}),
    ("find_merge_candidates", {}),
    ("get_perf_report", {}),
]

for name, params in steps:
    try:
        response, ms = call(PORT, name, params)
    except Exception as exc:
        print("FAIL", name, exc, flush=True)
        raise
    status = response.get("status")
    body = json.dumps(response.get("result", response), ensure_ascii=False)
    print(("OK  " if status == "success" else "ERR ") + name + " " + str(ms) + "ms " + body[:500], flush=True)
    if status != "success":
        raise SystemExit(1)
