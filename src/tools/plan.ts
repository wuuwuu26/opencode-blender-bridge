import fs from "node:fs"
import path from "node:path"
import type { Host } from "../host.js"
import {
  argsObject,
  errorResult,
  frameResult,
  guarded,
  objectSchema,
  str,
  textResult,
  bool,
  type ToolOutput,
} from "./common.js"
import { jsonText } from "../util.js"

interface OpDef {
  command: string
  description: string
  args: string
}

const OPS: Record<string, OpDef> = {
  "scene.info": { command: "get_scene_info", description: "Scene name, objects, counts, bbox, engine.", args: "limit?" },
  "scene.stats": { command: "get_scene_stats", description: "Object/type/polygon counts and scene bbox.", args: "{}" },
  "scene.audit": { command: "audit_scene", description: "Find empty meshes, missing materials, bad scale, zero-area faces.", args: "limit?" },
  "scene.frame": { command: "set_frame", description: "Set (and read) the current frame.", args: "frame?" },
  "scene.collections": { command: "list_collections", description: "List collections; pass name to create, or object+collection to link.", args: "name?, parent?, object?, collection?" },
  "scene.world": { command: "set_world", description: "World background color and strength.", args: "color?, strength?" },
  "object.list": { command: "list_objects", description: "List objects with type, location, size and materials.", args: "type_filter?, limit?, selected_only?" },
  "object.info": { command: "get_object_info", description: "Full detail for one object.", args: "name" },
  "object.measure": { command: "measure_object", description: "Bounding box, surface area, mesh volume, triangle and non-manifold counts.", args: "name" },
  "object.create": { command: "add_primitive", description: "Create a mesh primitive.", args: "kind, name?, location?, rotation?, scale?, size?, radius?, depth?, segments?" },
  "object.transform": { command: "set_transform", description: "Set location/rotation(deg)/scale.", args: "name, location?, rotation?, scale?" },
  "object.delete": { command: "delete_objects", description: "Delete named objects.", args: "names" },
  "object.duplicate": { command: "duplicate_object", description: "Duplicate an object with an offset.", args: "name, offset?, count?" },
  "object.join": { command: "join_objects", description: "Join meshes into the first one.", args: "names, name?" },
  "object.rename": { command: "rename_object", description: "Rename an object.", args: "name, new_name" },
  "object.parent": { command: "set_parent", description: "Parent or unparent while keeping the world transform.", args: "child, parent?, keep_transform?" },
  "object.shade_smooth": { command: "shade_smooth", description: "Set polygon smooth shading.", args: "name, smooth?" },
  "object.modifier_add": { command: "add_modifier", description: "Add a modifier.", args: "name, modifier_type, params?" },
  "object.modifier_apply": { command: "apply_modifier", description: "Apply one or all modifiers.", args: "name, modifier?" },
  "object.convert": { command: "convert_to_mesh", description: "Convert curves/text/metaballs to mesh.", args: "name" },
  "material.list": { command: "list_materials", description: "List materials and their Principled values.", args: "{}" },
  "material.create": { command: "create_material", description: "Create or update a Principled material.", args: "name, base_color?, metallic?, roughness?, emission?, emission_strength?, alpha?" },
  "material.assign": { command: "assign_material", description: "Assign a material to an object.", args: "name, material, slot?" },
  "material.set": { command: "set_material_property", description: "Set base_color/metallic/roughness/emission on a material.", args: "material, property, value" },
  "material.remove": { command: "remove_material", description: "Remove a material datablock.", args: "material" },
  "camera.create": { command: "add_camera", description: "Create a camera aimed at a target.", args: "name?, location?, look_at?, lens?, ortho?, ortho_scale?" },
  "camera.set": { command: "set_camera", description: "Make a camera the scene camera.", args: "name" },
  "light.create": { command: "add_light", description: "Create a light aimed at a target.", args: "light_type?, name?, location?, energy?, color?, size?, look_at?" },
  "render.settings.get": { command: "get_render_settings", description: "Read engine, resolution, samples, camera.", args: "{}" },
  "render.settings": { command: "set_render_settings", description: "Change engine, resolution, samples, filepath.", args: "engine?, resolution_x?, resolution_y?, resolution_percentage?, samples?, filepath?, film_transparent?, fps?" },
  "render.still": { command: "render_still", description: "Render one still with the scene engine.", args: "filepath?, camera?, engine?, samples?, resolution_x?, resolution_y?, frame?" },
  "render.view": { command: "render_view", description: "Fast Workbench frame from a custom angle.", args: "filepath?, max_size?, from?, look_at?, lens?, ortho?, ortho_scale?, view_size?, view_mode?" },
  "export.scene": { command: "export_scene", description: "Export GLB/GLTF/FBX/OBJ/STL/USD/BLEND.", args: "filepath, format?, selected_only?" },
  "file.save": { command: "save_blend", description: "Save the current .blend (or a copy).", args: "filepath?" },
  "file.open": { command: "open_blend", description: "Open a .blend file.", args: "filepath" },
  "file.import": { command: "import_file", description: "Import GLB/GLTF/FBX/OBJ/STL/PLY.", args: "filepath" },
  "selection.get": { command: "get_selection", description: "Read the current selection.", args: "{}" },
  "selection.set": { command: "set_selection", description: "Replace the selection.", args: "names, active?" },
  "utility.merge_candidates": { command: "find_merge_candidates", description: "Find safe merge candidates (same materials, adjacent, unparented).", args: "max_groups?, min_gap?" },
  "utility.perf": { command: "get_perf_report", description: "Render/scene performance report; pass profile to apply.", args: "profile?, engine?" },
  "utility.marks": { command: "get_marks", description: "Read transform marks; pass marks to restore.", args: "names?, marks?" },
}

function catalogText(): string {
  const lines = [
    "Blender plan catalog — call blender_rt_plan(op=\"<family.operation>\", args={...}).",
    "Read-only ops: scene.info, scene.stats, scene.audit, object.list/info/measure, material.list, render.settings.get, selection.get, utility.perf/merge_candidates.",
    "",
  ]
  let family = ""
  for (const [key, def] of Object.entries(OPS)) {
    const name = key.split(".")[0]
    if (name !== family) {
      family = name
      lines.push(`[${family}]`)
    }
    lines.push(`  ${key}  args: ${def.args}`)
    lines.push(`    ${def.description}`)
  }
  lines.push("")
  lines.push("Direct tools: blender_rt_see, blender_rt_do, blender_rt_watch, blender_rt_worker, blender_viewport, blender_rt_headless, blender_rt_job, blender_rt_loop, blender_rt_txn, blender_rt_preset, blender_rt_perf, blender_rt_opt, blender_rt_cmd, blender_rt_commands.")
  return lines.join("\n")
}

export function planTool(host: Host) {
  return {
    name: "blender_rt_plan",
    description:
      "Capability catalog and the standard operation surface for modeling: scene/object/material/camera/light/render/export/file ops. " +
      "Start with op=\"catalog\" to see every operation and its arguments, then call op=\"<family.operation>\" with an args object. " +
      "Use blender_rt_do only for edits this catalog does not cover.",
    input: objectSchema(
      {
        op: { type: "string", description: "catalog, or <family>.<operation> such as object.create." },
        args: { type: "object", description: "Operation arguments, as listed by the catalog." },
        family: { type: "string", description: "Optional family when op omits it (read/object/material/...)." },
      },
      ["op"],
    ),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      const rawOp = str(input.op).trim()
      const family = str(input.family).trim()
      const key = family && !rawOp.includes(".") ? `${family}.${rawOp}` : rawOp
      if (!key || key === "catalog") return textResult(catalogText())
      return guarded(async () => {
        const def = OPS[key]
        if (!def) return errorResult(`Unknown op: ${key}`, "Run blender_rt_plan(op=\"catalog\") for the full list.")
        const args = argsObject(input.args)
        let command = def.command
        if (key === "scene.frame" && args.frame === undefined) command = "get_frame"
        if (key === "scene.collections" && args.name) command = "create_collection"
        if (key === "scene.collections" && args.object) command = "link_to_collection"
        if (key === "utility.perf" && (args.profile || args.engine)) command = "apply_perf_settings"
        if (key === "utility.marks" && args.marks) command = "restore_marks"
        let callArgs: Record<string, unknown> = args
        if ((key === "render.view" || key === "render.still") && !args.filepath) {
          callArgs = {
            ...args,
            filepath: path.join(host.framesDir, `${key.replace(".", "-")}-${Date.now()}.png`),
          }
        }
        const response = await host.bridge.call<Record<string, unknown>>(command, callArgs, { timeoutMs: 180_000 })
        const payload = response.result
        const lines = [`${key} ok · ${response.ms} ms`]
        if (payload.filepath) lines.push(`file: ${str(payload.filepath)}`)
        lines.push(jsonText(payload, 8000))
        if ((key === "render.view" || key === "render.still") && payload.filepath && fs.existsSync(str(payload.filepath))) {
          return frameResult(host, key, str(payload.filepath), lines.join("\n"), bool(args.force))
        }
        return textResult(lines.join("\n"), { command, ms: response.ms })
      })
    },
  }
}

export type { OpDef }
