import fs from "node:fs";
import path from "node:path";
import { errorResult, guarded, num, objectSchema, str, textResult, bool, mimeFor } from "./common.js";
import { startHeadless, summarizeHeadless } from "../headless.js";
import { fileUri } from "../util.js";
function asArgs(input) {
    return {
        script: input.script === undefined ? undefined : str(input.script),
        script_file: str(input.script_file) || undefined,
        file: str(input.file) || undefined,
        outdir: str(input.outdir) || undefined,
        timeout_ms: input.timeout_ms === undefined ? undefined : num(input.timeout_ms, 180_000),
        engine: str(input.engine) || undefined,
        args: str(input.args) || undefined,
        workdir: str(input.workdir) || undefined,
        factory_startup: input.factory_startup === undefined ? undefined : bool(input.factory_startup, true),
        env: input.env || undefined,
        shots: Array.isArray(input.shots) ? input.shots : undefined,
        hard_exit: input.hard_exit === undefined ? undefined : bool(input.hard_exit, true),
        include_noise: bool(input.include_noise),
    };
}
export function headlessTool(host) {
    return {
        name: "blender_rt_headless",
        description: "One-shot Blender background process (blender -b): batch geometry, validation, rendering, imports and exports without touching the GUI scene. " +
            "Runs script inline or script_file, opens an optional .blend, applies an engine, and returns stdout/stderr plus new files in outdir. " +
            "Use as_job=true or blender_rt_job for work longer than ~100 s. Shots renders named camera angles. Set result={...} for structured output.",
        input: objectSchema({
            script: { type: "string", description: "Python source. Alternative to script_file." },
            script_file: { type: "string", description: "Path to a .py file to run." },
            file: { type: "string", description: "Optional .blend file to open first." },
            outdir: { type: "string", description: "Output directory; new files are listed and added to sys.argv." },
            as_job: { type: "boolean", description: "Start a background job instead of waiting." },
            wait_s: { type: "number", description: "For as_job, seconds to wait before returning the job id." },
            timeout_ms: { type: "integer", description: "Process timeout. Default 180000, max 1800000." },
            engine: { type: "string", description: "eevee | cycles | workbench | keep | none. Default eevee." },
            args: { type: "string", description: "Extra command-line arguments exposed as sys.argv / K.args." },
            workdir: { type: "string", description: "Working directory and first sys.path entry." },
            factory_startup: { type: "boolean", description: "Use factory startup (default true)." },
            env: { type: "object", description: "Extra environment variables." },
            shots: { type: "array", description: "Camera angles to render: [{name,from,look_at,lens,ortho,res}]." },
            attach_images: { type: "boolean", description: "Attach the rendered shots to the reply." },
            out_json: { type: "string", description: "Write the structured result JSON to this path." },
            hard_exit: { type: "boolean", description: "Hard-exit Blender after the run (default true)." },
            include_noise: { type: "boolean", description: "Include __pycache__ and .blend1 in the file list." },
        }),
        async execute(input) {
            return guarded(async () => {
                const blender = host.blenderPath();
                if (!blender)
                    return errorResult("Blender executable not found", "Set blenderPath in plugin options or OCBB_BLENDER.");
                const args = asArgs(input);
                if (args.timeout_ms)
                    args.timeout_ms = Math.min(args.timeout_ms, 1_800_000);
                if (bool(input.as_job)) {
                    const job = host.jobs.start(args, "headless");
                    const wait = num(input.wait_s, 0);
                    if (wait > 0)
                        await host.jobs.wait(job.id, wait);
                    const latest = host.jobs.get(job.id);
                    return textResult(`headless job started\njob: ${job.id}\nstatus: ${latest?.status}\nrun: ${job.runDir}\n\n` +
                        "Collect it with blender_rt_job(op=\"status\") or blender_rt_job(op=\"result\").", { jobId: job.id });
                }
                const handle = startHeadless({ blenderPath: blender, dataDir: host.dataDir }, args);
                const result = await handle.done;
                const text = summarizeHeadless(result);
                if (str(input.out_json)) {
                    try {
                        fs.writeFileSync(path.resolve(str(input.out_json)), JSON.stringify(result.payload, null, 2), "utf8");
                    }
                    catch {
                        // best effort
                    }
                }
                if (bool(input.attach_images) && result.payload.shots?.length) {
                    const files = [];
                    for (const shot of result.payload.shots.slice(0, 3)) {
                        if (fs.existsSync(shot.filepath))
                            files.push({ type: "file", uri: fileUri(shot.filepath), mime: mimeFor(shot.filepath), name: path.basename(shot.filepath) });
                    }
                    if (files.length)
                        return { content: [{ type: "text", text }, ...files], metadata: { ok: result.ok } };
                }
                return textResult(text, { ok: result.ok, exitCode: result.exitCode, runDir: result.runDir });
            });
        },
    };
}
export { asArgs };
