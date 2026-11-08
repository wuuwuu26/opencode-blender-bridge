import { BridgeError } from "../bridge.js";
import { argsObject, errorResult, guarded, num, objectSchema, str, textResult } from "./common.js";
import { jsonText } from "../util.js";
export function cmdTool(host) {
    return {
        name: "blender_rt_cmd",
        description: "Call any add-on command directly with its parameters (escape hatch for commands not wrapped by plan). " +
            "Run blender_rt_commands first to see the exact command names. Examples: get_world_state_snapshot, get_object_info {name}, " +
            "execute_code {code}, render_view {...}. The GUI add-on must be connected.",
        input: objectSchema({
            name: { type: "string", description: "Add-on command name." },
            params: { type: "object", description: "Parameter object matching the add-on signature." },
            timeout_ms: { type: "integer", description: "Timeout. Default 120000." },
            max_chars: { type: "integer", description: "Response cap. Default 12000." },
        }, ["name"]),
        async execute(input) {
            return guarded(async () => {
                const name = str(input.name);
                if (!name)
                    return errorResult("blender_rt_cmd needs name", "Use blender_rt_commands to list command names.");
                const params = argsObject(input.params);
                const response = await host.bridge.call(name, params, {
                    timeoutMs: Math.min(num(input.timeout_ms, 120_000), 600_000),
                });
                const cap = Math.min(Math.max(500, num(input.max_chars, 12_000)), 100_000);
                return textResult(`CMD ${name} ok · ${response.ms} ms\n${jsonText(response.result, cap)}`, { command: name, ms: response.ms });
            }).catch((error) => error instanceof BridgeError
                ? errorResult(error.message, "Check the command name and parameters with blender_rt_commands.")
                : errorResult(error instanceof Error ? error.message : String(error)));
        },
    };
}
export function commandsTool(host) {
    return {
        name: "blender_rt_commands",
        description: "List the add-on commands currently available over the bridge, plus the connected Blender version, scene and file. " +
            "Run it before blender_rt_cmd so the model uses real command names and parameters.",
        input: objectSchema({}),
        async execute() {
            return guarded(async () => {
                const info = await host.bridge.info(6000);
                const capabilities = Array.isArray(info.capabilities) ? info.capabilities : [];
                let sceneLine = "";
                try {
                    const scene = await host.bridge.call("get_scene_stats", {}, { timeoutMs: 10_000 });
                    sceneLine = `scene ${str(scene.result.scene)} · ${str(scene.result.objects)} objects · ${str(scene.result.total_polygons)} polys · engine ${str(scene.result.engine)}`;
                }
                catch {
                    // scene stats are optional
                }
                const lines = [
                    `${str(info.name)} ${Array.isArray(info.addon_version) ? info.addon_version.join(".") : ""} · Blender ${str(info.blender_version)}`,
                    `protocol ${str(info.protocol_version)} · ${info.background ? "background" : "GUI"} · ${info.file ? "file " + str(info.file) : "unsaved file"}`,
                    sceneLine,
                    `available commands (${capabilities.length}):`,
                    capabilities.join(", "),
                    "",
                    "No gated integrations: every listed command is available (except write commands while AI is paused).",
                ].filter(Boolean);
                return textResult(lines.join("\n"), { commands: capabilities });
            });
        },
    };
}
