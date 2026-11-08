import fs from "node:fs"
import path from "node:path"
import type { Host } from "../host.js"
import { BridgeError } from "../bridge.js"
import { errorResult, frameResult, guarded, num, objectSchema, str, textResult, bool, type ToolOutput } from "./common.js"
import { hashFile, sleep } from "../util.js"

export function watchTool(host: Host) {
  return {
    name: "blender_rt_watch",
    description:
      "Sample the viewport or camera over a time window or frame range and report whether the image changed. " +
      "Use it after animation, physics or a long operator to prove something actually moved, instead of taking two hand-timed screenshots.",
    input: objectSchema({
      frames: { type: "integer", description: "Number of samples. Default 6." },
      interval_ms: { type: "integer", description: "Milliseconds between time samples. Default 500." },
      frame_start: { type: "integer", description: "First frame of a frame-range sample." },
      frame_end: { type: "integer", description: "Last frame of a frame-range sample." },
      step: { type: "integer", description: "Frame step. Default 1." },
      max_size: { type: "integer", description: "Longest edge per sample. Default 480." },
      session: { type: "string", description: "Headless worker session name." },
      from: { type: "string", description: "Camera position \"x,y,z\"." },
      look_at: { type: "string", description: "Camera target \"x,y,z\"." },
      force: { type: "boolean", description: "Attach the final frame even if unchanged." },
    }),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      return guarded(async () => {
        const count = Math.max(2, Math.min(60, num(input.frames, 6)))
        const interval = Math.max(0, Math.min(30_000, num(input.interval_ms, 500)))
        const maxSize = num(input.max_size, 480)
        const session = str(input.session)
        const useFrames = input.frame_start !== undefined && input.frame_end !== undefined
        const step = Math.max(1, num(input.step, 1))
        const samples: Array<{ index: number; frame?: number; file: string; hash: string; changed: boolean }> = []
        let lastFile = ""
        for (let index = 0; index < count; index++) {
          const frame = useFrames ? num(input.frame_start, 1) + index * step : undefined
          if (useFrames && frame! > num(input.frame_end, frame!)) break
          const file = path.join(host.framesDir, `watch-${Date.now()}-${index}.png`)
          const params = {
            filepath: file,
            max_size: maxSize,
            from: input.from as string | undefined,
            look_at: input.look_at as string | undefined,
          }
          if (session) {
            if (frame !== undefined) await host.workers.exec(session, `bpy.context.scene.frame_set(${frame})\n`)
            await host.workers.see(session, params)
          } else {
            if (frame !== undefined) await host.bridge.call("set_frame", { frame }, { timeoutMs: 30_000 })
            await host.bridge.call("render_view", params, { timeoutMs: 120_000 })
          }
          if (!fs.existsSync(file)) throw new Error("Blender returned no frame for sample " + index)
          const hash = hashFile(file)
          const changed = samples.length > 0 && samples[samples.length - 1].hash !== hash
          samples.push({ index, frame, file, hash, changed })
          lastFile = file
          if (index < count - 1) await sleep(interval)
        }
        const changedCount = samples.filter((sample) => sample.changed).length
        const lines = [
          `watch · ${samples.length} samples · ${changedCount} change${changedCount === 1 ? "" : "s"}`,
          ...samples.map(
            (sample) =>
              `  ${sample.index}${sample.frame !== undefined ? ` frame ${sample.frame}` : ""} ${sample.hash} ${
                sample.index === 0 ? "baseline" : sample.changed ? "CHANGED" : "same"
              }`,
          ),
        ]
        if (changedCount === 0) lines.push("The image never changed; the operation may not have taken effect.")
        if (!lastFile) return textResult(lines.join("\n"))
        lines.push(`last frame: ${lastFile}`)
        return frameResult(host, "watch", lastFile, lines.join("\n"), bool(input.force))
      }).catch((error) =>
        error instanceof BridgeError ? errorResult(error.message) : errorResult(error instanceof Error ? error.message : String(error)),
      )
    },
  }
}
