import json
import sys

from client import call

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 51235
steps = [
    ("ping", {}),
    ("get_scene_info", {"limit": 5}),
    ("get_viewport_screenshot", {"max_size": 640, "filepath": "tests/gui_viewport.png"}),
    ("screenshot_area", {"area": 0, "max_size": 800, "filepath": "tests/gui_area.png"}),
    ("render_view", {"max_size": 480, "filepath": "tests/gui_render.png", "from": [6, -6, 4], "look_at": [0, 0, 1]}),
    ("execute_code", {"code": "print('gui code ok')\nresult = {'selected': [o.name for o in bpy.context.selected_objects]}\n"}),
]
for name, params in steps:
    response, ms = call(PORT, name, params)
    print(name, ms, "ms", json.dumps(response, ensure_ascii=False)[:400], flush=True)
