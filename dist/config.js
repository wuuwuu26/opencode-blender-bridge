import { asRecord, num, str } from "./util.js";
export const PLUGIN_ID = "opencode.blender-bridge";
export const PLUGIN_VERSION = "0.2.0";
export const DEFAULT_PORT = 9876;
export const ADDON_PROTOCOL_VERSION = 1;
export function resolveConfig(options) {
    const raw = asRecord(options);
    const atta = asRecord(raw.atta);
    const envPort = Number(process.env.OCBB_PORT || process.env.OPENCODE_BLENDER_PORT || 0);
    const port = num(raw.port, 0) || (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);
    const blenderPath = str(raw.blenderPath) || process.env.OCBB_BLENDER || process.env.BLENDER_PATH || undefined;
    const attaPython = str(raw.attaPython) || str(atta.python) || process.env.ATTA_PYTHON || undefined;
    const attaRoot = str(raw.attaRoot) || str(atta.root) || process.env.ATTA_ROOT || undefined;
    const attaHome = str(raw.attaHome) || str(atta.home) || process.env.ATTA_HOME || undefined;
    return {
        host: str(raw.host, "127.0.0.1") || "127.0.0.1",
        port,
        blenderPath,
        frameMaxSize: Math.max(160, Math.min(num(raw.frameMaxSize, 720), 2048)),
        workerTtlMs: Math.max(60_000, num(raw.workerTtlMs, Number(process.env.OCBB_WORKER_TTL_MS || 900_000))),
        attaPython,
        attaRoot,
        attaHome,
        attaRepo: str(raw.attaRepo) || str(atta.repo) || "git+https://github.com/laszapens/Atta.git",
    };
}
