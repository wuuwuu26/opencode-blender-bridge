import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHost } from "../dist/host.js"
import { buildTools } from "../dist/tools/index.js"

const project = fs.mkdtempSync(path.join(os.tmpdir(), "ocbb-project-"))
const host = createHost(project, { port: Number(process.env.OCBB_PORT || 51234) })
const tools = Object.fromEntries(buildTools(host).map((tool) => [tool.name, tool]))

function show(name, output) {
  const content = output?.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => (part.type === "text" ? part.text : `[file ${part.uri}]`))
            .join("\n")
        : JSON.stringify(output)
  console.log(`\n=== ${name} ===\n${text.slice(0, 1600)}`)
  if (output?.metadata?.error) process.exitCode = 1
  return text
}

async function run(name, input) {
  try {
    const output = await tools[name].execute(input, { sessionID: "ses_test" })
    return show(name, output)
  } catch (error) {
    console.error(`\n=== ${name} FAILED ===\n`, error)
    process.exitCode = 1
    return ""
  }
}

await run("blender_rt_commands", {})
await run("blender_rt_plan", { op: "catalog" })
await run("blender_rt_plan", { op: "scene.stats" })
await run("blender_rt_plan", { op: "object.create", args: { kind: "cube", name: "PluginCube", location: [2, 0, 1] } })
await run("blender_rt_plan", { op: "material.create", args: { name: "PluginMat", base_color: "#2266cc", roughness: 0.35 } })
await run("blender_rt_plan", { op: "material.assign", args: { name: "PluginCube", material: "PluginMat" } })
await run("blender_rt_plan", { op: "render.view", args: { max_size: 480, from: [6, -6, 4], look_at: [0, 0, 1] } })
await run("blender_rt_see", { max_size: 480, from: [5, -5, 3], look_at: [0, 0, 1] })
await run("blender_rt_watch", { frames: 2, interval_ms: 100, max_size: 320 })
await run("blender_rt_txn", { op: "snapshot", name: "smoke", note: "plugin smoke test" })
await run("blender_rt_txn", { op: "list" })
await run("blender_viewport", { op: "status" })
await run("blender_viewport", { op: "doctor" })
await run("blender_viewport", { op: "lease", action: "status" })
await run("blender_rt_worker", { op: "start", name: "smoke" })
await run("blender_rt_worker", { op: "exec", name: "smoke", code: "bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0,0,1))\nresult = {'objects': len(bpy.context.scene.objects)}\n" })
await run("blender_rt_worker", { op: "see", name: "smoke", max_size: 400 })
await run("blender_rt_worker", { op: "status", name: "smoke" })
await run("blender_rt_worker", { op: "stop", name: "smoke" })
await run("blender_rt_headless", {
  script:
    "import bpy, json\nbpy.ops.mesh.primitive_cube_add(size=2)\nresult = {'objects': len(bpy.context.scene.objects), 'version': bpy.app.version_string}\nprint('done')\n",
  outdir: path.join(project, "headless-out"),
  engine: "workbench",
})
await run("blender_rt_job", {
  op: "start",
  label: "smoke-job",
  script: "import bpy, time\nresult = {'objects': len(bpy.context.scene.objects)}\n",
  wait_s: 0,
})
const jobsText = await run("blender_rt_job", { op: "list" })
console.log("\n=== jobs ===\n" + jobsText)
await host.workers.stopAll()
console.log("\nproject:", project)
