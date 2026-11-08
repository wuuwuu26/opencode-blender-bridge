import fs from "node:fs"
import path from "node:path"
import type { Host } from "../host.js"
import { formatAttaEnvelope, type AttaEnvelope } from "../atta.js"
import {
  argsObject,
  errorResult,
  frameResult,
  guarded,
  num,
  objectSchema,
  str,
  textResult,
  bool,
  type FilePart,
  type ToolOutput,
} from "./common.js"
import { fileUri, jsonText, safeName } from "../util.js"

function imagesContent(text: string, files: string[]): ToolOutput {
  if (!files.length) return textResult(text)
  const parts: FilePart[] = files.map((file) => ({
    type: "file",
    uri: fileUri(file),
    mime: "image/png",
    name: path.basename(file),
  }))
  return { content: [{ type: "text", text }, ...parts], metadata: { images: files } }
}

export function cadTool(host: Host) {
  return {
    name: "blender_rt_cad",
    description:
      "Parametric CAD with Atta: spec-driven geometry, measured facts, three-state verification and Blender-backed delivery. " +
      "Ops: doctor, catalog, spec, model, variant, describe, verify, preview, deliver, run, import, setup, status. " +
      "Build a model, read facts with describe, gate it with verify (pass/degraded/fail), then preview or deliver; import delivers a GLB and loads it into the live Blender GUI. " +
      "Needs Atta (MIT, github.com/laszapens/Atta); run op=setup once or set attaPython. Facts before pixels: verify before claiming a part is done.",
    input: objectSchema(
      {
        op: {
          type: "string",
          description:
            "doctor | catalog | spec | model | variant | describe | verify | preview | deliver | run | import | setup | status",
        },
        args: { type: "object", description: "Arguments passed verbatim to the Atta tool (spec, recipe, params, constraints, formats, ...)." },
        timeout_ms: { type: "integer", description: "Timeout for the Atta call." },
        attach_images: { type: "boolean", description: "Attach PNGs returned by preview (default true, max 3)." },
        max_size: { type: "integer", description: "For op=import, the frame longest edge. Default 800." },
        python: { type: "string", description: "For op=setup: system Python used to create the venv." },
        source: { type: "string", description: "For op=setup: pip source (default git+https://github.com/laszapens/Atta.git)." },
        reset: { type: "boolean", description: "For op=setup: recreate the venv first." },
      },
      ["op"],
    ),
    async execute(input: Record<string, unknown>, context?: { signal?: AbortSignal; sessionID?: string }): Promise<ToolOutput> {
      return guarded(async () => {
        const op = str(input.op, "doctor").toLowerCase()
        const args = argsObject(input.args)
        const timeoutMs = input.timeout_ms === undefined ? undefined : num(input.timeout_ms, 120_000)
        const signal = context?.signal

        if (op === "status") {
          return textResult(jsonText(host.atta.status(true), 4000), { atta: host.atta.status(true) })
        }

        if (op === "setup" || op === "install") {
          const result = await host.atta.setup({
            python: str(input.python) || undefined,
            source: str(input.source) || undefined,
            reset: bool(input.reset),
            timeoutMs: num(input.timeout_ms, 900_000),
          })
          const status = host.atta.status(true)
          return textResult(
            `Atta installed\n${jsonText(result, 4000)}\n\nstatus:\n${jsonText(status, 3000)}`,
            { installed: true },
          )
        }

        if (op === "doctor") {
          const status = host.atta.status(true)
          if (!status.available) {
            return errorResult(
              "Atta is not available: " + (status.error || "not installed"),
              'Run blender_rt_cad(op="setup") to create .opencode/atta-venv and install Atta, or set attaPython to a Python that can import atta.',
            )
          }
          const envelope = await host.atta.call("atta_doctor", args, { timeoutMs, signal })
          const text = formatAttaEnvelope(envelope) + "\n\nstatus:\n" + jsonText(status, 3000)
          return textResult(text, { ok: envelope.ok, atta: status })
        }

        if (op === "import") {
          const outdir = str(args.outdir) || path.join(host.projectDir, "cad")
          const deliverArgs: Record<string, unknown> = {
            formats: ["glb"],
            ...args,
            outdir,
          }
          if (Array.isArray(deliverArgs.formats) && deliverArgs.formats.length === 0) deliverArgs.formats = ["glb"]
          if (typeof deliverArgs.formats === "string" && !String(deliverArgs.formats).includes("glb")) {
            deliverArgs.formats = ["glb"]
          }
          const envelope = await host.atta.call("atta_deliver", deliverArgs, { timeoutMs: timeoutMs ?? 600_000, signal })
          if (!envelope.ok) return textResult(formatAttaEnvelope(envelope), { ok: false })
          const files = host.atta.deliverFiles(envelope.data, [".glb", ".gltf"])
          const glb = files.find((file) => file.toLowerCase().endsWith(".glb")) || files[0]
          const lines = [formatAttaEnvelope(envelope)]
          if (!glb) {
            lines.push("", "Deliver produced no GLB; nothing was imported into Blender.")
            return textResult(lines.join("\n"), { ok: false })
          }
          lines.push("", `importing ${glb} into the live Blender session...`)
          try {
            const imported = await host.bridge.call<Record<string, unknown>>(
              "import_file",
              { filepath: glb },
              { timeoutMs: 180_000, signal },
            )
            lines.push("import: " + jsonText(imported.result, 3000))
            const importedNames = Array.isArray(imported.result.imported)
              ? (imported.result.imported as string[])
              : []
            const data = (envelope.data || {}) as Record<string, unknown>
            const modelInfo = (data.model || {}) as Record<string, unknown>
            const modelName = str(modelInfo.name) || str(args.name) || path.basename(glb, path.extname(glb))
            if (importedNames.length) {
              const desired = "ATTA_" + safeName(modelName, "model")
              try {
                await host.bridge.call(
                  "rename_object",
                  { name: importedNames[0], new_name: desired },
                  { timeoutMs: 15_000, signal },
                )
                lines.push("object: " + desired)
              } catch {
                // The imported name is still usable.
              }
            }
            const frameFile = path.join(host.framesDir, `cad-import-${Date.now()}.png`)
            const frame = await host.bridge.call<Record<string, unknown>>(
              "render_view",
              { filepath: frameFile, max_size: num(input.max_size, 800) },
              { timeoutMs: 120_000, signal },
            )
            const shown = str(frame.result.filepath, frameFile)
            if (fs.existsSync(shown)) {
              lines.push("frame: " + shown)
              return frameResult(host, "cad-import", shown, lines.join("\n"), true)
            }
            return textResult(lines.join("\n"), { imported: true, glb })
          } catch (error) {
            lines.push(
              "",
              "Delivered the GLB, but the live Blender import failed: " +
                (error instanceof Error ? error.message : String(error)),
            )
            lines.push("Start Blender with blender_viewport(op=\"launch\") and retry, or open the GLB manually.")
            return textResult(lines.join("\n"), { ok: true, imported: false, glb })
          }
        }

        const tool = `atta_${op}`
        const envelope: AttaEnvelope = await host.atta.call(tool, args, { timeoutMs, signal })
        const text = formatAttaEnvelope(envelope, 9000)
        if (!envelope.ok) return textResult(text, { ok: false, tool })
        const files = bool(input.attach_images, true) ? host.atta.images(envelope.data, 3) : []
        const output = imagesContent(text, files)
        return { ...output, metadata: { ...(output.metadata || {}), ok: true, tool, ms: envelope.ms } }
      })
    },
  }
}
