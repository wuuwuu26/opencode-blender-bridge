// Integration smoke test for blender_rt_cad.
// Requires Atta installed (blender_rt_cad op=setup) and optionally a live Blender.
import path from "node:path"
import { createHost } from "../dist/host.js"
import { buildTools } from "../dist/tools/index.js"

const project = process.env.OCBB_CAD_PROJECT || process.cwd()
const host = createHost(project, { port: Number(process.env.OCBB_PORT || 9876) })
const tools = Object.fromEntries(buildTools(host).map((tool) => [tool.name, tool]))
const cad = tools.blender_rt_cad

function text(output) {
  const content = output?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (part.type === "text" ? part.text : `[file ${part.uri}]`)).join("\n")
  return JSON.stringify(output)
}

console.log(text(await cad.execute({ op: "status" }, { sessionID: "ses_test" })))
console.log(text(await cad.execute({ op: "doctor", args: { deep: false } }, { sessionID: "ses_test" })))

console.log(
  text(
    await cad.execute(
      {
        op: "model",
        args: {
          recipe: "part.bracket",
          name: "cad-smoke",
          quality: "draft",
          params: { length: 120, width: 70, thickness: 8, hole_radius: 6, hole_spacing: 80, corner_radius: 10 },
        },
      },
      { sessionID: "ses_test" },
    ),
  ),
)

console.log(text(await cad.execute({ op: "describe", args: { wall: true, perceive: false } }, { sessionID: "ses_test" })))
console.log(
  text(
    await cad.execute(
      {
        op: "verify",
        args: { level: "standard", constraints: { bbox: { x: [110, 130], y: [60, 80], z: [6, 10] }, closed: true, genus: 2 } },
      },
      { sessionID: "ses_test" },
    ),
  ),
)
console.log(
  text(
    await cad.execute(
      { op: "deliver", args: { formats: ["glb"], outdir: path.join(project, "cad") } },
      { sessionID: "ses_test" },
    ),
  ),
)
console.log("project:", project)
await host.workers.stopAll()
