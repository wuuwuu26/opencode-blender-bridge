import { asRecord, num, str } from "./util.js"

export interface BridgeConfig {
  host: string
  port: number
  blenderPath?: string
  frameMaxSize: number
  workerTtlMs: number
}

export const PLUGIN_ID = "opencode.blender-bridge"
export const PLUGIN_VERSION = "0.1.0"
export const DEFAULT_PORT = 9876
export const ADDON_PROTOCOL_VERSION = 1

export function resolveConfig(options: unknown): BridgeConfig {
  const raw = asRecord(options)
  const envPort = Number(process.env.OCBB_PORT || process.env.OPENCODE_BLENDER_PORT || 0)
  const port = num(raw.port, 0) || (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT)
  const blenderPath =
    str(raw.blenderPath) || process.env.OCBB_BLENDER || process.env.BLENDER_PATH || undefined
  return {
    host: str(raw.host, "127.0.0.1") || "127.0.0.1",
    port,
    blenderPath,
    frameMaxSize: Math.max(160, Math.min(num(raw.frameMaxSize, 720), 2048)),
    workerTtlMs: Math.max(60_000, num(raw.workerTtlMs, Number(process.env.OCBB_WORKER_TTL_MS || 900_000))),
  }
}
