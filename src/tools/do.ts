import fs from "node:fs"
import path from "node:path"
import { BridgeError } from "../bridge.js"
import type { Host } from "../host.js"
import { errorResult, frameResult, bridgeHint, num, objectSchema, str, textResult, bool, type ToolOutput } from "./common.js"
import { jsonText } from "../util.js"

function codeError(error: unknown): ToolOutput {
  if (error instanceof BridgeError && error.code === "addon_error") {
    const raw = error.message
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const lines = [`Blender raised ${str(parsed.exception_type, "an exception")}: ${str(parsed.message)}`]
      if (parsed.stdout) lines.push("stdout:\n" + str(parsed.stdout).slice(-3000))
      if (parsed.traceback) lines.push("traceback:\n" + str(parsed.traceback))
      return { content: lines.join("\n"), metadata: { error: true } }
    } catch {
      return errorResult(raw)
    }
  }
  return errorResult(error instanceof Error ? error.message : String(error))
}

export function doTool(host: Host) {
  return {
    name: "blender_rt_do",
    description:
      "Drive Blender live: execute Python in a persistent kernel on the Blender main thread, optionally return a frame immediately. " +
      "Use it for edits that plan does not cover; prefer blender_rt_plan ops for standard modeling. GUI when connected, otherwise a persistent headless worker " +
      "(exec + Workbench frame, 50-150 ms per step). Namespace preloads bpy, math, mathutils, Vector, json, os, sys and a persistent K object; " +
      "set result = {...} to return structured data. Errors keep stdout and traceback. Long (>100 s) work belongs in blender_rt_job.",
    input: objectSchema({
      code: { type: "string", description: "Python source executed in Blender's main thread. Alternative to file." },
      file: { type: "string", description: "Path to a .py file to run instead of inline code." },
      see: { type: "boolean", description: "Return a frame after execution. Default true." },
      max_size: { type: "integer", description: "Frame longest edge in pixels. Default 640." },
      force: { type: "boolean", description: "Resend an identical frame." },
      session: { type: "string", description: "Headless worker session name." },
      auto: { type: "boolean", description: "Fall back to a headless worker when the GUI is unreachable. Default true." },
      from: { type: "string", description: "Camera position for the returned frame \"x,y,z\"." },
      look_at: { type: "string", description: "Camera target for the returned frame \"x,y,z\"." },
      timeout_ms: { type: "integer", description: "Execution timeout. Default 120000." },
      preload: { type: "string", description: "Reserved: comma-separated modules to import before the code." },
    }),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      try {
        const code = str(input.code)
        const file = str(input.file)
        if (!code && !file) return errorResult("blender_rt_do needs code or file")
        const session = str(input.session)
        const timeoutMs = Math.min(Math.max(1000, num(input.timeout_ms, 120_000)), 600_000)
        const lines: string[] = []
        const usedSession = session || (input.auto === false ? "" : "")
        let result: Record<string, unknown>
        let source = "gui"
        if (session) {
          result = await host.workers.exec(session, code || undefined, {
            file: file || undefined,
            timeoutMs,
          })
          source = `worker:${usedSession}`
        } else {
          try {
            const response = await host.bridge.call<Record<string, unknown>>(
              "execute_code",
              { ...(code ? { code } : {}), ...(file ? { file } : {}) },
              { timeoutMs },
            )
            result = response.result
          } catch (error) {
            if (error instanceof BridgeError && error.code === "addon_error") throw error
            const offline = error instanceof BridgeError && error.code === "unreachable"
            if (!offline || input.auto === false) throw error
            result = await host.workers.exec("default", code || undefined, { file: file || undefined, timeoutMs })
            source = "worker:default"
          }
        }
        lines.push(`executed · ${source} · ${str(result.ms ?? "", "?")} ms`)
        if (result.result !== undefined && result.result !== null) lines.push("result: " + jsonText(result.result, 4000))
        const stdout = str(result.stdout)
        if (stdout) lines.push("stdout:\n" + stdout.slice(-6000))
        const stderr = str(result.stderr)
        if (stderr) lines.push("stderr:\n" + stderr.slice(-3000))

        if (input.see === false) return textResult(lines.join("\n"))

        const maxSize = num(input.max_size, 640)
        const frameFile = path.join(host.framesDir, `do-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`)
        let frame: Record<string, unknown>
        if (session || source.startsWith("worker")) {
          frame = await host.workers.see(session || "default", {
            filepath: frameFile,
            max_size: maxSize,
            from: input.from as string | undefined,
            look_at: input.look_at as string | undefined,
          })
        } else {
          try {
            const response = await host.bridge.call<Record<string, unknown>>(
              "render_view",
              {
                filepath: frameFile,
                max_size: maxSize,
                from: input.from,
                look_at: input.look_at,
              },
              { timeoutMs: 120_000 },
            )
            frame = response.result
          } catch {
            const response = await host.bridge.call<Record<string, unknown>>(
              "get_viewport_screenshot",
              { filepath: frameFile, max_size: maxSize },
              { timeoutMs: 60_000 },
            )
            frame = response.result
          }
        }
        const shown = str(frame.filepath, frameFile)
        if (!fs.existsSync(shown)) return textResult(lines.join("\n") + "\n(no frame returned)")
        lines.push(`frame: ${shown}`)
        if (frame.width) lines.push(`size: ${str(frame.width)}x${str(frame.height)}`)
        return frameResult(host, "do", shown, lines.join("\n"), bool(input.force))
      } catch (error) {
        if (error instanceof BridgeError && error.code !== "addon_error") return errorResult(error.message, bridgeHint(error))
        return codeError(error)
      }
    },
  }
}
