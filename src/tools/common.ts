import path from "node:path"
import { BridgeError } from "../bridge.js"
import type { Host } from "../host.js"
import { errorText, fileUri, hashFile } from "../util.js"

export interface FilePart {
  type: "file"
  uri: string
  mime: string
  name?: string
}

export interface ToolOutput {
  content: string | Array<{ type: "text"; text: string } | FilePart>
  metadata?: Record<string, unknown>
}

export function textResult(text: string, metadata?: Record<string, unknown>): ToolOutput {
  return metadata ? { content: text, metadata } : { content: text }
}

export function errorResult(message: string, hint?: string): ToolOutput {
  const text = "ERROR " + message + (hint ? "\n\n" + hint : "")
  return { content: text, metadata: { error: true } }
}

export function mimeFor(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  return "image/png"
}

export function frameResult(
  host: Host,
  key: string,
  file: string,
  summary: string,
  force = false,
): ToolOutput {
  const hash = hashFile(file)
  const previous = host.lastFrames.get(key)
  if (!force && hash && previous === hash) {
    return textResult(summary + "\n(frame unchanged — same pixels as last call; pass force=true to resend)")
  }
  if (hash) host.lastFrames.set(key, hash)
  const content: Array<{ type: "text"; text: string } | FilePart> = [
    { type: "text", text: summary },
    { type: "file", uri: fileUri(file), mime: mimeFor(file), name: path.basename(file) },
  ]
  return { content, metadata: { frame: file, hash } }
}

export function bridgeHint(error: unknown): string | undefined {
  if (error instanceof BridgeError) {
    if (error.code === "unreachable")
      return (
        "Start Blender, then in the 3D viewport open the OpenCode sidebar (N panel) and press Connect. " +
        "Or run blender_viewport with op=launch, or use a headless session with blender_rt_worker."
      )
    if (error.code === "timeout")
      return "The operation took too long. Move long work to blender_rt_job or blender_rt_headless."
    if (error.code === "addon_error") return "The add-on rejected the command; check the parameters and the Blender report."
  }
  return undefined
}

export async function guarded(fn: () => Promise<ToolOutput>): Promise<ToolOutput> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof BridgeError) return errorResult(error.message, bridgeHint(error))
    return errorResult(errorText(error))
  }
}

export function str(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  return String(value)
}

export function num(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback
  return Boolean(value)
}

export function argsObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: true,
})
