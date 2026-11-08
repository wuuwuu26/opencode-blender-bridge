import fs from "node:fs"
import path from "node:path"
import { Plugin, Skill } from "@opencode/plugin"
import { PLUGIN_ID, PLUGIN_VERSION } from "./config.js"
import { createHost } from "./host.js"
import { buildTools } from "./tools/index.js"
import { skillsDir } from "./paths.js"
import { str } from "./util.js"

const SKILL_ID = "blender-modeling"
const SKILL_FILE = path.join(skillsDir, "blender-modeling", "SKILL.md")
const CAD_SKILL_ID = "cad-modeling"
const CAD_SKILL_FILE = path.join(skillsDir, "cad-modeling", "SKILL.md")

function skillContent(file: string, fallback: string): string {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return fallback
  }
}

async function blenderStatusLine(dir: string, options: unknown): Promise<string> {
  const host = createHost(dir, options)
  const probe = host.blenderProbe()
  const lines = [`OpenCode Blender Bridge ${PLUGIN_VERSION}`]
  lines.push(`blender: ${probe.path || "not found"}`)
  try {
    const info = await host.bridge.info(4000)
    const caps = Array.isArray(info.capabilities) ? info.capabilities.length : 0
    lines.push(
      `bridge: connected · ${str(info.name)} · Blender ${str(info.blender_version)} · ${caps} commands${
        info.background ? " · background" : ""
      }`,
    )
    lines.push(`scene: ${str(info.scene)}${info.file ? " · " + str(info.file) : " · unsaved"}`)
  } catch (error) {
    lines.push(`bridge: offline · ${error instanceof Error ? error.message : String(error)}`)
    lines.push("Fix: open Blender > 3D viewport > N panel > OpenCode > Connect, or run blender_viewport op=launch.")
  }
  const sessions = host.workers.list()
  lines.push(`headless sessions: ${sessions.length ? sessions.map((session) => String(session.name)).join(", ") : "none"}`)
  const atta = host.atta.status()
  lines.push(
    atta.available
      ? `atta: ${atta.version} (${atta.python})`
      : "atta: not installed (blender_rt_cad op=setup)",
  )
  return lines.join("\n")
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const directory = ctx.location?.directory || process.cwd()
    const host = createHost(directory, ctx.options)

    const tools = buildTools(host)
    await ctx.tool.transform((editor) => {
      for (const tool of tools) editor.add(tool as never)
    })
    console.log(`[blender-bridge] registered ${tools.length} tools on port ${host.config.port}`)

    try {
      await ctx.skill.transform((editor) => {
        editor.add({
          id: Skill.ID.make(SKILL_ID),
          name: Skill.Name.make("Blender Modeling"),
          description:
            "Drive a real Blender session: inspect the scene, model step by step with frames, audit, snapshot, render and export.",
          autoinvoke: true,
          path: Skill.Info.fields.path.make(SKILL_FILE),
          content: skillContent(
            SKILL_FILE,
            [
              "# Blender modeling with OpenCode",
              "",
              "1. Run `blender_viewport` with op=doctor; it must return kind=ok (or start a headless worker).",
              "2. Read `blender_rt_plan` op=catalog before inventing operations.",
              "3. Look with `blender_rt_see`, change one thing, look again.",
              "4. Snapshot with `blender_rt_txn` before risky edits.",
              "5. Export with `blender_rt_plan` op=export.scene and check the file.",
            ].join("\n"),
          ),
        })
        editor.add({
          id: Skill.ID.make(CAD_SKILL_ID),
          name: Skill.Name.make("Parametric CAD (Atta)"),
          description:
            "Spec-driven parametric CAD with measured facts and a three-state verify gate, delivered to Blender as GLB/STEP/mesh.",
          autoinvoke: true,
          path: Skill.Info.fields.path.make(CAD_SKILL_FILE),
          content: skillContent(
            CAD_SKILL_FILE,
            [
              "# Parametric CAD with Atta",
              "",
              "1. `blender_rt_cad(op=\"doctor\")`; install with op=setup if missing.",
              "2. `blender_rt_cad(op=\"catalog\")` before inventing a spec.",
              "3. Build with op=model, then read facts with op=describe.",
              "4. Gate with op=verify; only pass/degraded may be delivered.",
              "5. Preview for judgement, then deliver or import into the live Blender scene.",
            ].join("\n"),
          ),
        })
      })
    } catch {
      // Skill registration is optional; the tools still work.
    }

    try {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "blender",
          description: "Show Blender bridge status (no model call)",
          execute: async ({ sessionID }) => {
            const text = await blenderStatusLine(directory, ctx.options)
            await ctx.session.synthetic({ sessionID, text })
          },
        })
      })
    } catch {
      // Commands are optional on hosts without the command surface.
    }

    return async () => {
      await host.jobs.cancelAll().catch(() => undefined)
      await host.workers.stopAll().catch(() => undefined)
    }
  },
})

export { buildTools }
