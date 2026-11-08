import type { Host } from "../host.js"
import { errorResult, guarded, num, objectSchema, str, textResult, type ToolOutput } from "./common.js"
import { jsonText } from "../util.js"

export function perfTool(host: Host) {
  return {
    name: "blender_rt_perf",
    description:
      "Diagnose and fix render performance: engine, samples, resolution percentage, polygon load, modifiers and image memory, with concrete recommendations. " +
      "op=apply writes a fast/balanced/quality profile to the scene.",
    input: objectSchema({
      op: { type: "string", description: "report | apply" },
      profile: { type: "string", description: "fast | balanced | quality" },
      engine: { type: "string", description: "Optionally switch engine: eevee | cycles | workbench." },
    }),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      return guarded(async () => {
        const op = str(input.op, "report").toLowerCase()
        if (op === "apply") {
          const response = await host.bridge.call<Record<string, unknown>>(
            "apply_perf_settings",
            { profile: str(input.profile, "fast"), engine: str(input.engine) || undefined },
            { timeoutMs: 30_000 },
          )
          return textResult(`perf apply · ${str(input.profile, "fast")}\n${jsonText(response.result, 6000)}`)
        }
        const response = await host.bridge.call<Record<string, unknown>>("get_perf_report", {}, { timeoutMs: 30_000 })
        const report = response.result
        const lines = [
          `perf · ${str(report.engine)} · ${jsonText(report.resolution)} · ${str(report.objects)} objects · ${str(report.polygons)} polys`,
          "recommendations:",
          ...(Array.isArray(report.recommendations) ? report.recommendations.map((item: string) => "  - " + item) : []),
          "",
          jsonText(report, 5000),
        ]
        return textResult(lines.join("\n"), { report })
      })
    },
  }
}

export function optTool(host: Host) {
  return {
    name: "blender_rt_opt",
    description:
      "Find safe object merges to cut scene overhead: same materials, adjacent bounding boxes, no modifiers or parents. " +
      "op=candidates only reports; op=merge joins the objects you name explicitly. Never merges by itself.",
    input: objectSchema({
      op: { type: "string", description: "candidates | merge" },
      names: { type: "array", description: "Objects to join for op=merge." },
      name: { type: "string", description: "Name for the joined result." },
      max_groups: { type: "integer", description: "Candidate cap. Default 20." },
      min_gap: { type: "number", description: "Adjacency threshold as a fraction of scene radius. Default 0.02." },
    }),
    async execute(input: Record<string, unknown>): Promise<ToolOutput> {
      return guarded(async () => {
        const op = str(input.op, "candidates").toLowerCase()
        if (op === "merge") {
          const names = Array.isArray(input.names) ? (input.names as string[]).map(String) : []
          if (names.length < 2) return errorResult("merge needs at least two names")
          const response = await host.bridge.call<Record<string, unknown>>(
            "join_objects",
            { names, name: str(input.name) || undefined },
            { timeoutMs: 60_000 },
          )
          return textResult(`merged ${names.length} objects\n${jsonText(response.result, 3000)}`)
        }
        const response = await host.bridge.call<Record<string, unknown>>(
          "find_merge_candidates",
          { max_groups: num(input.max_groups, 20), min_gap: num(input.min_gap, 0.02) },
          { timeoutMs: 60_000 },
        )
        const candidates = Array.isArray(response.result.candidates) ? response.result.candidates : []
        if (!candidates.length) return textResult("No safe merge candidates found.")
        const lines = [`merge candidates · ${candidates.length}`]
        for (const candidate of candidates as Array<Record<string, unknown>>) {
          lines.push(
            `  - ${String(candidate.polygons)} polys · ${Array.isArray(candidate.objects) ? candidate.objects.join(", ") : "?"}`,
          )
        }
        lines.push("", "Merging is explicit: call op=merge with names.")
        return textResult(lines.join("\n"), { candidates })
      })
    },
  }
}
