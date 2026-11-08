---
name: cad-modeling
description: Parametric CAD with Atta: spec-driven geometry, measured facts, three-state verification and Blender-backed delivery. Use for functional parts, mechanical assemblies, enclosures, brackets, 3D-printing models and any design with dimensions or constraints.
---

# Parametric CAD with Atta

Atta turns a part into a **rebuildable spec**, computes geometry in deterministic
Python, measures it, and only then allows a render or export. A screenshot is
judgement, never evidence.

Use this skill when the request is about a functional part, dimensions, tolerances,
wall thickness, manufacturability or a repeatable design. Use the plain
`blender-modeling` skill for visual/organic scenes.

## 1. Gate: install and doctor

```text
blender_rt_cad(op="doctor")
```

- `ok` — Atta and Blender are ready.
- Not installed — run `blender_rt_cad(op="setup")` once (creates
  `.opencode/atta-venv` and installs Atta), or set `attaPython` in plugin options.
- No Blender — facts, verify and STEP still work; preview and mesh delivery need
  `blender_viewport(op="launch")`.

Check `blender_viewport(op="doctor")` as well when you need previews or GLB import.

## 2. Catalog before inventing a spec

```text
blender_rt_cad(op="catalog", args={verbose:true})
```

23 recipes and 25 feature ops. Recipes are the short path (`product.mug`,
mechanical and architectural families). A graph spec composes ops such as
`box`, `cylinder`, `difference`, `loft`, `pattern_linear`; all arguments in **mm**.

## 3. Build

Recipe:

```text
blender_rt_cad(op="model", args={recipe:"product.mug", quality:"draft",
  params:{height:95, wall:3.2, handle_enabled:true}})
```

Spec (JSON, `schema:"atta.spec/v3"`):

```text
blender_rt_cad(op="spec", args={op:"validate", spec:{...}})
blender_rt_cad(op="model", args={spec:{...}})
```

The response carries `model_id`. Later calls default to the most recent model.
Use `patches` to refine instead of rebuilding from scratch.

## 4. Facts before pixels

```text
blender_rt_cad(op="describe", args={wall:true, curvature:true})
blender_rt_cad(op="describe", args={perceive:true, res:32})
```

Read bbox, volume, topology, wall thickness, rays, sections and the ASCII
perception. Do not guess dimensions from a screenshot.
`perceive` is a sub-second viewfinder; use it while iterating.

## 5. Verify — the three-state gate

```text
blender_rt_cad(op="verify", args={level:"standard",
  constraints:{bbox:{z:[80,120]}, min_wall_mm:2.4}})
```

- `pass` — deliver is allowed.
- `degraded` — deliver only with an explicit `allow_degraded:true` and say why.
- `fail` — stop. Every failure carries `code`, `path`, `fix`; treat it as a patch.
  Fix the spec, rebuild, verify again.

Never claim a part is done on `fail`, and never hand-wave a failed constraint.

## 6. Preview and deliver

```text
blender_rt_cad(op="preview", args={mode:"studio", views:["hero","front"], res:1200})
blender_rt_cad(op="deliver", args={formats:["glb","step","stl"]})
```

Preview renders are for judgement; the facts and the verify receipt are the
evidence. Delivery is gated by verify and writes a manifest.

## 7. Bring it into the live Blender scene

```text
blender_rt_cad(op="import", args={name:"bracket-01"})
```

`import` runs `deliver` for GLB, imports it into the connected Blender GUI and
returns a frame. Then use `blender_rt_see`, `blender_rt_plan` or `blender_rt_txn`
to place, render and snapshot it with the rest of the scene.

## 8. Rules

- Units are millimetres in specs; convert at the boundary.
- Prefer constraints (`bbox`, `volume_mm3`, `min_wall_mm`) over eyeballing.
- Use `variant` to search parameters; use `run` for multi-step pipelines.
- Keep the spec in the project (or in the conversation) so the part is
  reproducible; a mesh without a spec is not a CAD deliverable.
- Blender is a backend for renders/exports, not the source of truth for a
  functional part.
