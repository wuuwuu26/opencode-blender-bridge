import fs from "node:fs";
import path from "node:path";
import { errorResult, guarded, objectSchema, str, textResult } from "./common.js";
import { jsonText, readJson, writeJson } from "../util.js";
const BUILTINS = [
    {
        name: "render_review_fast",
        kind: "render",
        builtin: true,
        data: { profile: "fast", resolution_percentage: 50, samples: 24 },
        note: "Half resolution, low samples for quick review",
    },
    {
        name: "render_review_quality",
        kind: "render",
        builtin: true,
        data: { profile: "quality", resolution_percentage: 100, samples: 128 },
        note: "Full resolution, more samples for a delivery still",
    },
    {
        name: "view_three_quarter",
        kind: "view",
        builtin: true,
        data: { from: "7,-7,5", look_at: "0,0,1", lens: 50, max_size: 720 },
        note: "Classic three-quarter view for blender_rt_see",
    },
];
function load(host) {
    return readJson(host.presetsFile, {});
}
function save(host, presets) {
    writeJson(host.presetsFile, presets);
}
function find(host, name) {
    return load(host)[name] || BUILTINS.find((preset) => preset.name === name);
}
export function presetTool(host) {
    return {
        name: "blender_rt_preset",
        description: "Reusable parameter presets for renders, cameras, materials and views: save, list, apply, export, delete. " +
            "Presets are plain JSON under .opencode/blender/presets.json, so a look can be reproduced across sessions and machines. " +
            "Built-ins: render_review_fast, render_review_quality, view_three_quarter.",
        input: objectSchema({
            op: { type: "string", description: "save | list | get | apply | export | delete" },
            name: { type: "string", description: "Preset name." },
            kind: { type: "string", description: "render | camera | material | view | object" },
            data: { type: "object", description: "Preset payload (arguments of the matching call)." },
            note: { type: "string", description: "Optional note." },
            target: { type: "string", description: "Object to receive a material preset." },
            filepath: { type: "string", description: "Destination for op=export." },
        }, ["op"]),
        async execute(input) {
            return guarded(async () => {
                const op = str(input.op, "list").toLowerCase();
                const name = str(input.name);
                const presets = load(host);
                if (op === "list") {
                    const all = [...Object.values(presets).sort((a, b) => (b.at || 0) - (a.at || 0)), ...BUILTINS];
                    return textResult(all
                        .map((preset) => `${preset.name} · ${preset.kind}${preset.builtin ? " · built-in" : ""}${preset.note ? " · " + preset.note : ""}`)
                        .join("\n"));
                }
                if (op === "get") {
                    const preset = find(host, name);
                    return preset ? textResult(jsonText(preset, 5000)) : errorResult("Preset not found: " + name);
                }
                if (op === "save") {
                    if (!name)
                        return errorResult("save needs name");
                    const preset = {
                        name,
                        kind: str(input.kind, "render") || "render",
                        data: input.data || {},
                        at: Date.now(),
                        note: str(input.note) || undefined,
                    };
                    presets[name] = preset;
                    save(host, presets);
                    return textResult(`preset saved: ${name} (${preset.kind})\n${jsonText(preset.data, 3000)}`);
                }
                if (op === "delete") {
                    if (!presets[name])
                        return errorResult("Preset not found: " + name, "Built-ins cannot be deleted.");
                    delete presets[name];
                    save(host, presets);
                    return textResult("preset deleted: " + name);
                }
                if (op === "export") {
                    const target = str(input.filepath);
                    if (!target)
                        return errorResult("export needs filepath");
                    const targetPath = path.resolve(target);
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.writeFileSync(targetPath, JSON.stringify({ version: 1, presets: { ...presets, ...Object.fromEntries(BUILTINS.map((p) => [p.name, p])) } }, null, 2), "utf8");
                    return textResult("presets exported to " + targetPath);
                }
                if (op === "apply") {
                    const preset = find(host, name);
                    if (!preset)
                        return errorResult("Preset not found: " + name);
                    const data = { ...preset.data };
                    if (preset.kind === "render" && data.profile) {
                        const response = await host.bridge.call("apply_perf_settings", { profile: data.profile }, { timeoutMs: 30_000 });
                        return textResult(`applied ${preset.name}\n${jsonText(response.result, 4000)}`);
                    }
                    const command = preset.kind === "render"
                        ? "set_render_settings"
                        : preset.kind === "camera"
                            ? "add_camera"
                            : preset.kind === "material"
                                ? "create_material"
                                : preset.kind === "object"
                                    ? "set_transform"
                                    : "";
                    if (!command)
                        return textResult(`Preset ${preset.name} is a view preset:\n${jsonText(data, 3000)}\nPass these values to blender_rt_see.`);
                    const response = await host.bridge.call(command, data, { timeoutMs: 60_000 });
                    if (preset.kind === "material" && str(input.target)) {
                        const material = response.result.name || str(data.name);
                        await host.bridge.call("assign_material", { name: str(input.target), material }, { timeoutMs: 30_000 });
                    }
                    return textResult(`applied ${preset.name} (${preset.kind})\n${jsonText(response.result, 4000)}`);
                }
                return errorResult("Unknown op: " + op, "op is save | list | get | apply | export | delete");
            });
        },
    };
}
