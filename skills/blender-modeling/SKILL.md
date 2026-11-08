---
name: blender-modeling
description: Drive a real Blender session from OpenCode: inspect, model step by step with frames, audit, snapshot, render and export. Use for any 3D modeling, scene, material, render or GLB/FBX export task.
---

# Blender modeling with OpenCode

You are working in a real Blender session (GUI, or a persistent headless worker). Model in
small steps: **look → change one thing → look again**. Never claim a visual result you did
not see.

For functional, dimensioned or manufacturable parts, use the `cad-modeling` skill
(Atta) instead: spec → facts → verify → deliver.

To clear a scratch scene, remove objects with `execute_code`; avoid
`bpy.ops.wm.read_factory_settings`, which can unload the add-on and drop the bridge.

## 1. Connect before modeling

1. `blender_viewport(op="doctor")`.
   - `kind=ok` → drive the GUI.
   - `kind=gui_offline` → ask the user to open Blender, `N` panel, **OpenCode → Connect**, or run `blender_viewport(op="launch")`.
   - `kind=no_blender` → only fix the install; nothing else works.
2. If only headless is possible: `blender_rt_worker(op="start", name="main")`, then
   `blender_rt_worker(op="see", name="main")`. That frame is your viewport.

## 2. Look before touching anything

- `blender_rt_see` — viewport frame, ~50–150 ms. Add `from` + `look_at` for a custom angle
  without moving the user's viewport.
- `blender_rt_plan(op="scene.stats")` — object/poly counts and scene bbox.
- `blender_rt_plan(op="object.list")` — names, types, transforms, materials.
- `blender_rt_plan(op="scene.audit")` — broken meshes, missing materials, bad scale.

Do not create something that already exists. Check names first.

## 3. Prefer plan ops over raw Python

`blender_rt_plan(op="catalog")` is the source of truth. Common sequence:

| Step | Call |
| --- | --- |
| Create | `plan(op="object.create", args={kind:"cube", name:"Body", location:[0,0,1]})` |
| Shape | `plan(op="object.transform", ...)`, `object.modifier_add`, `object.modifier_apply` |
| Material | `plan(op="material.create", ...)`, then `material.assign` |
| Camera | `plan(op="camera.create", args={location:[7,-7,5], look_at:[0,0,1], lens:50})` |
| Light | `plan(op="light.create", args={light_type:"AREA", energy:800, size:5})` |
| Look | `blender_rt_see(max_size=720)` |
| Check | `plan(op="scene.audit")`, `plan(op="object.measure", args={name:"Body"})` |
| Export | `plan(op="export.scene", args={filepath:"out/model.glb"})` |

Use `blender_rt_do` only when no plan op covers the edit (custom bmesh, drivers, geometry nodes).
Set `result = {...}` so the next step gets structured data. Keep the call under ~100 s.

## 4. Modeling rules

- **Units and scale.** Check the scene bbox before choosing sizes. Set the scale on the object
  (or apply it) and keep objects at real-world proportions.
- **Modifier order.** Mirror → bevel → subdivision → weighted normal. Apply destructive
  modifiers only after a snapshot.
- **Shading.** `object.shade_smooth` for curved surfaces; keep hard edges with an
  Edge Split or auto-smooth. Flat cubes that look melted are a shading bug, not geometry.
- **Origins.** Put origins at the joint or the base before animating or duplicating.
- **Naming.** Name every object you create (`Body`, `Wheel.FL`, `Ground`). Unnamed
  `Cube.014` objects make later steps fragile.
- **Collections.** Group assemblies; link with `scene.collections`.
- **Materials.** One Principled material per surface type; check base color in a frame, since
  Workbench frames show material viewport colors.

## 5. Undo checkpoints

Before any risky batch (boolean, remesh, join, import, open, delete):

1. `blender_rt_txn(op="snapshot", name="before-boolean")` — full .blend copy.
2. `blender_rt_txn(op="mark", names=["Body"], name="body-pose")` — transforms only.

Roll back with `op="restore"` / `op="restore_mark"`. Snapshots live in
`.opencode/blender/txn`; they never overwrite the user's file.

## 6. Long work

- Rendering or batch > ~100 s: `blender_rt_job(op="start", ...)`, then
  `blender_rt_job(op="result", id=...)`.
- One-shot batch/validation/import: `blender_rt_headless`.
- Parameter sweep: `blender_rt_loop` with `values` and a `metric`.
- Never hold `blender_rt_do` open for a long render; it blocks the UI.

## 7. Delivery checklist

- [ ] Frame from the intended camera, not just the default viewport.
- [ ] `scene.audit` has no empty meshes, missing materials or negative scale.
- [ ] Object names and collections are intentional.
- [ ] Export exists and is non-zero bytes (`export.scene` returns `bytes`).
- [ ] Snapshot taken before any destructive step.

## 8. Failure patterns

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Frame is black/empty | object behind camera or empty scene | `see` with explicit `from`/`look_at`, check `scene.stats` |
| `frame unchanged` | nothing moved | pass `force=true` only when you need the same image again |
| `Unknown command` | wrong add-on command | `blender_rt_commands`, then `blender_rt_cmd` |
| Bridge offline | add-on not connected | doctor + Connect, or `blender_viewport(op="launch")` |
| Write rejected `AI_PAUSED` | user paused AI in Blender | ask the user to resume; do not retry in a loop |
| Export 0 bytes | path/permissions or unsupported format | use an absolute path under the project; GLB/FBX/OBJ/STL |
