import fs from "node:fs"
import path from "node:path"
import { BridgeError } from "../bridge.js"
import type { Host } from "../host.js"
import { frameResult, guarded, num, objectSchema, str, textResult, bool, type ToolOutput } from "./common.js"

export function seeTool(host: Host) {
  return {
    name: "blender_rt_see",
    description:
      "See what Blender sees: return one frame in 50-150 ms so you can change one thing and look again. " +
      "Uses the GUI viewport when Blender is connected; with from/look_at it renders a custom camera angle without touching the user's viewport. " +
      "full=true screenshots the whole Blender UI. If the GUI is offline (or session is given) it falls back to a persistent headless worker. " +
      "Identical frames are not re-attached unless force=true. Details: blender_rt_plan(op=\"catalog\").",
    input: objectSchema({
      max_size: { type: "integer", description: "Longest edge in pixels. Default 640; 480 is faster, 960 is clearer." },
      session: { type: "string", description: "Headless worker session name; skips the GUI." },
      auto: { type: "boolean", description: "Fall back to a headless worker when the GUI is unreachable. Default true." },
      full: { type: "boolean", description: "Screenshot the whole Blender window instead of the 3D viewport." },
      area: { type: "integer", description: "Area index for full=true. Default 0." },
      from: { type: "string", description: "Custom camera position \"x,y,z\" in world space." },
      look_at: { type: "string", description: "Custom camera target \"x,y,z\"." },
      lens: { type: "number", description: "Focal length in mm for the custom view. Default 50." },
      ortho: { type: "boolean", description: "Orthographic custom view." },
      ortho_scale: { type: "number", description: "Orthographic scale; default 10." },
      view_size: { type: "string", description: "Custom view resolution \"WxH\"." },
      shading: { type: "string", description: "WIREFRAME | SOLID | MATERIAL | RENDERED (best effort)." },
      overlays: { type: "boolean", description: "Include viewport overlays where supported." },
      view_mode: { type: "string", description: "viewport (fast Workbench) or render (scene engine, slower)." },
      diagnostics: { type: "boolean", description: "Add scene counts and an empty-frame warning." },
      force: { type: "boolean", description: "Resend the frame even if the pixels did not change." },
    }),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      return guarded(async () => {
        const maxSize = num(input.max_size, 640)
        const force = bool(input.force)
        const file = path.join(host.framesDir, `see-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`)
        const session = str(input.session)
        const custom = input.from !== undefined || input.look_at !== undefined
        let data: Record<string, unknown>
        let source: string
        if (session) {
          data = await host.workers.see(session, {
            filepath: file,
            max_size: maxSize,
            from: input.from as string | undefined,
            look_at: input.look_at as string | undefined,
            lens: input.lens as number | undefined,
            ortho: input.ortho as boolean | undefined,
            view_size: input.view_size as string | undefined,
          })
          source = `worker:${session}`
        } else {
          try {
            if (input.full) {
              const response = await host.bridge.call<Record<string, unknown>>(
                "screenshot_area",
                { filepath: file, area: num(input.area, 0), max_size: maxSize },
                { timeoutMs: 60_000 },
              )
              data = response.result
            } else if (custom) {
              const response = await host.bridge.call<Record<string, unknown>>(
                "render_view",
                {
                  filepath: file,
                  max_size: maxSize,
                  from: input.from,
                  look_at: input.look_at,
                  lens: input.lens,
                  ortho: input.ortho,
                  ortho_scale: input.ortho_scale,
                  view_size: input.view_size,
                  shading: input.shading,
                  view_mode: input.view_mode,
                },
                { timeoutMs: 120_000 },
              )
              data = response.result
            } else {
              const response = await host.bridge.call<Record<string, unknown>>(
                "get_viewport_screenshot",
                { filepath: file, max_size: maxSize, format: "png" },
                { timeoutMs: 60_000 },
              )
              data = response.result
            }
            source = "gui"
          } catch (error) {
            const offline = error instanceof BridgeError && error.code === "unreachable"
            if (!offline || input.auto === false) throw error
            data = await host.workers.see("default", {
              filepath: file,
              max_size: maxSize,
              from: input.from as string | undefined,
              look_at: input.look_at as string | undefined,
              lens: input.lens as number | undefined,
              ortho: input.ortho as boolean | undefined,
              view_size: input.view_size as string | undefined,
            })
            source = "worker:default"
          }
        }
        const shown = str(data.filepath, file)
        if (!fs.existsSync(shown)) {
          return textResult(`Blender returned no image (${JSON.stringify(data)})`, { error: true })
        }
        const bytes = fs.statSync(shown).size
        const lines = [
          `frame · ${source} · ${str(data.width, "?")}x${str(data.height, "?")} · ${bytes} bytes`,
          `file: ${shown}`,
        ]
        if (data.method) lines.push(`method: ${str(data.method)}`)
        if (bytes < 3000) lines.push("warning: frame is very small and may be empty")
        if (bool(input.diagnostics) && source === "gui") {
          try {
            const stats = await host.bridge.call<Record<string, unknown>>("get_scene_stats", {}, { timeoutMs: 10_000 })
            lines.push(
              `scene: ${str(stats.result.objects)} objects · ${str(stats.result.total_polygons)} polys · engine ${str(stats.result.engine)}`,
            )
            if (num(stats.result.objects, 1) === 0) lines.push("warning: scene is empty")
          } catch {
            // diagnostics are optional
          }
        }
        return frameResult(host, "see", shown, lines.join("\n"), force)
      })
    },
  }
}
