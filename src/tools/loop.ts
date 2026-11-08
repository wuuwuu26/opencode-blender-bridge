import type { Host } from "../host.js"
import { errorResult, guarded, num, objectSchema, str, textResult, type ToolOutput } from "./common.js"
import { jsonText } from "../util.js"

export function loopTool(host: Host) {
  return {
    name: "blender_rt_loop",
    description:
      "Parameter search inside one persistent headless Blender session: run the same script for each value in values, read a metric from result, and rank the candidates. " +
      "Each run gets P (the current value) in the namespace. Set result={...} (or print one JSON object) including the metric key. " +
      "Use it for fit checks, proportions, light strength, render settings and similar sweeps.",
    input: objectSchema(
      {
        values: { type: "array", description: "Values to try; each is exposed as P." },
        code: { type: "string", description: "Script run once per value. Set result with the metric." },
        metric: { type: "string", description: "Metric key in result. Default score." },
        mode: { type: "string", description: "max (default) or min." },
        session: { type: "string", description: "Worker session name. Default loop." },
        setup: { type: "string", description: "Optional code run once before the loop." },
        timeout_ms: { type: "integer", description: "Per-run timeout. Default 120000." },
        max_runs: { type: "integer", description: "Safety cap. Default 50." },
      },
      ["values", "code"],
    ),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      return guarded(async () => {
        const values = Array.isArray(input.values) ? (input.values as unknown[]) : []
        if (!values.length) return errorResult("values must be a non-empty array")
        const code = str(input.code)
        if (!code) return errorResult("loop needs code")
        const metric = str(input.metric, "score") || "score"
        const mode = str(input.mode, "max").toLowerCase()
        const session = str(input.session, "loop") || "loop"
        const timeoutMs = num(input.timeout_ms, 120_000)
        const maxRuns = Math.min(Math.max(1, num(input.max_runs, 50)), 200)
        const runs = values.slice(0, maxRuns)
        if (str(input.setup)) await host.workers.exec(session, str(input.setup), { timeoutMs })
        const rows: Array<{ index: number; value: unknown; metric?: number; ok: boolean; ms?: number; error?: string }> = []
        for (let index = 0; index < runs.length; index++) {
          const value = runs[index]
          const source = `P = ${JSON.stringify(value)}\n${code}\n`
          try {
            const result = await host.workers.exec(session, source, { timeoutMs })
            let score: number | undefined
            const payload = result.result as Record<string, unknown> | number | undefined
            if (typeof payload === "number") score = payload
            else if (payload && typeof payload === "object" && typeof payload[metric] === "number")
              score = payload[metric] as number
            if (score === undefined) {
              const match = String(result.stdout || "").match(new RegExp(`"${metric}"\\s*:\\s*(-?[0-9.]+)`))
              if (match) score = Number(match[1])
            }
            rows.push({ index, value, metric: score, ok: true, ms: num(result.ms, 0) })
          } catch (error) {
            rows.push({ index, value, ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        }
        const scored = rows.filter((row) => row.ok && row.metric !== undefined) as Array<{
          index: number
          value: unknown
          metric: number
        }>
        scored.sort((a, b) => (mode === "min" ? a.metric - b.metric : b.metric - a.metric))
        const lines = [
          `loop · ${rows.length} runs · metric=${metric} · mode=${mode}`,
          ...rows.map(
            (row) =>
              `  #${row.index} P=${jsonText(row.value, 200)} → ${
                row.metric !== undefined ? row.metric : row.error ? "ERROR " + row.error : "no metric"
              }`,
          ),
        ]
        if (scored.length) lines.push("", `best: #${scored[0].index} ${metric}=${scored[0].metric} · P=${jsonText(scored[0].value, 300)}`)
        else lines.push("", "No run produced the metric; make sure the script sets result or prints one JSON object.")
        return textResult(lines.join("\n"), { best: scored[0], runs: rows.length })
      })
    },
  }
}
