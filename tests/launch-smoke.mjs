import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHost } from "../dist/host.js"
import { buildTools } from "../dist/tools/index.js"

const project = fs.mkdtempSync(path.join(os.tmpdir(), "ocbb-launch-"))
const port = Number(process.env.OCBB_PORT || 51236)
const host = createHost(project, { port })
const tools = Object.fromEntries(buildTools(host).map((tool) => [tool.name, tool]))

const text = (output) =>
  typeof output.content === "string"
    ? output.content
    : output.content.map((part) => (part.type === "text" ? part.text : `[file ${part.uri}]`)).join("\n")

console.log("launch:", text(await tools.blender_viewport.execute({ op: "launch", timeout_ms: 120000 }, { sessionID: "ses_test" })))
console.log("doctor:", text(await tools.blender_viewport.execute({ op: "doctor" }, { sessionID: "ses_test" })))
console.log("see:", text(await tools.blender_rt_see.execute({ max_size: 480 }, { sessionID: "ses_test" })))
console.log("plan:", text(await tools.blender_rt_plan.execute({ op: "scene.stats" }, { sessionID: "ses_test" })))
await host.workers.stopAll()
