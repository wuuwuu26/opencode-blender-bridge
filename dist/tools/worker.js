import fs from "node:fs";
import path from "node:path";
import { errorResult, frameResult, guarded, num, objectSchema, str, textResult, bool } from "./common.js";
import { jsonText } from "../util.js";
export function workerTool(host) {
    return {
        name: "blender_rt_worker",
        description: "Persistent headless Blender session (blender -b): start a worker, exec Python, see a Workbench frame, reset the scene, check status, stop or restart. " +
            "The scene and the Python namespace survive between calls, so this is the interactive fallback when no GUI is available. " +
            "Same session name reuses the same process; idle sessions are stopped after the TTL. Run several named sessions for parallel batch work.",
        input: objectSchema({
            op: {
                type: "string",
                description: "start | exec | see | reset | status | stop | restart | list",
            },
            name: { type: "string", description: "Session name. Default default." },
            code: { type: "string", description: "Python source for op=exec." },
            file: { type: "string", description: "Optional .blend file to open at start." },
            timeout_ms: { type: "integer", description: "Execution timeout. Default 120000." },
            preload: { type: "string", description: "Comma-separated modules to import once after start." },
            warmup: { type: "boolean", description: "Warm up the renderer after start. Default true." },
            from: { type: "string", description: "Camera position for op=see \"x,y,z\"." },
            look_at: { type: "string", description: "Camera target for op=see \"x,y,z\"." },
            lens: { type: "number", description: "Focal length for op=see." },
            ortho: { type: "boolean", description: "Orthographic op=see." },
            view_size: { type: "string", description: "Resolution for op=see \"WxH\"." },
            max_size: { type: "integer", description: "Longest edge for op=see. Default 640." },
            gpu: { type: "string", description: "auto | true | false (Cycles only)." },
            engine: { type: "string", description: "eevee | cycles | workbench | keep. Default eevee." },
            purge_prefix: { type: "string", description: "Comma-separated module prefixes to drop from sys.modules before exec." },
            force: { type: "boolean", description: "Resend an identical frame." },
        }, ["op"]),
        async execute(input) {
            return guarded(async () => {
                const op = str(input.op, "status").toLowerCase();
                const name = str(input.name, "default") || "default";
                const blender = host.blenderPath();
                if (op === "list")
                    return textResult(jsonText(host.workers.list(), 6000));
                if (op === "stop")
                    return textResult(jsonText(await host.workers.stop(name), 2000));
                if (op === "status")
                    return textResult(jsonText(await host.workers.status(name, blender), 6000));
                if (op === "reset")
                    return textResult(jsonText(await host.workers.reset(name, blender), 3000));
                if (op === "start" || op === "restart") {
                    if (op === "restart")
                        await host.workers.stop(name);
                    if (!blender)
                        return errorResult("Blender executable not found. Set blenderPath in plugin options or OCBB_BLENDER.", "blender_viewport op=doctor reports the search results.");
                    const started = await host.workers.start({
                        name,
                        blender,
                        file: str(input.file) || undefined,
                        engine: str(input.engine) || "eevee",
                        warmup: input.warmup !== false,
                    });
                    if (str(input.preload)) {
                        const modules = str(input.preload)
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean);
                        await host.workers
                            .exec(name, `import importlib\nfor _m in ${JSON.stringify(modules)}:\n    importlib.import_module(_m)\nresult = {"preloaded": ${JSON.stringify(modules)}}\n`)
                            .catch(() => undefined);
                    }
                    return textResult(jsonText(started, 4000));
                }
                if (op === "exec") {
                    let code = str(input.code);
                    if (!code)
                        return errorResult("op=exec needs code");
                    const purge = str(input.purge_prefix);
                    if (purge) {
                        const prefixes = purge.split(",").map((item) => item.trim()).filter(Boolean);
                        code =
                            `import sys\nfor _k in [k for k in list(sys.modules) if any(k == p or k.startswith(p + ".") for p in ${JSON.stringify(prefixes)})]:\n    sys.modules.pop(_k, None)\n` +
                                code;
                    }
                    const result = await host.workers.exec(name, code, {
                        file: str(input.file) || undefined,
                        timeoutMs: num(input.timeout_ms, 120_000),
                    });
                    const lines = [`worker ${name} · exec · ${str(result.ms, "?")} ms`];
                    if (result.result !== undefined && result.result !== null)
                        lines.push("result: " + jsonText(result.result, 4000));
                    if (str(result.stdout))
                        lines.push("stdout:\n" + str(result.stdout).slice(-6000));
                    if (str(result.stderr))
                        lines.push("stderr:\n" + str(result.stderr).slice(-3000));
                    return textResult(lines.join("\n"));
                }
                if (op === "see") {
                    const file = path.join(host.framesDir, `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`);
                    const frame = await host.workers.see(name, {
                        filepath: file,
                        max_size: num(input.max_size, 640),
                        from: input.from,
                        look_at: input.look_at,
                        lens: input.lens,
                        ortho: input.ortho,
                        view_size: input.view_size,
                    });
                    const shown = str(frame.filepath, file);
                    if (!fs.existsSync(shown))
                        return errorResult("Worker returned no frame");
                    return frameResult(host, `worker-${name}`, shown, `worker ${name} frame · ${str(frame.width, "?")}x${str(frame.height, "?")}\nfile: ${shown}`, bool(input.force));
                }
                return errorResult("Unknown op: " + op, "op is start | exec | see | reset | status | stop | restart | list");
            });
        },
    };
}
