import fs from "node:fs";
import path from "node:path";
import { errorResult, guarded, objectSchema, str, textResult } from "./common.js";
import { ensureDir, jsonText, readJson, safeName, stamp, writeJson } from "../util.js";
function snapshotDir(host) {
    return ensureDir(path.join(host.txnsDir, "snapshots"));
}
function markDir(host) {
    return ensureDir(path.join(host.txnsDir, "marks"));
}
function listMeta(dir) {
    try {
        return fs
            .readdirSync(dir)
            .filter((name) => name.endsWith(".json"))
            .map((name) => readJson(path.join(dir, name), undefined))
            .filter((item) => Boolean(item));
    }
    catch {
        return [];
    }
}
function findSnapshot(host, key) {
    const all = listMeta(snapshotDir(host));
    return all.find((item) => item.id === key) || all.find((item) => item.name === key) || all.find((item) => item.id.startsWith(key));
}
function findMark(host, key) {
    const all = listMeta(markDir(host));
    return all.find((item) => item.id === key) || all.find((item) => item.label === key) || all.find((item) => item.id.startsWith(key));
}
export function txnTool(host) {
    return {
        name: "blender_rt_txn",
        description: "Undo checkpoints for agent work: whole-file .blend snapshots and object-level transform marks. " +
            "snapshot saves a copy, mark records selected objects, restore/restore_mark roll back. Use txn before risky edits instead of hoping undo covers it. " +
            "Snapshots live under .opencode/blender/txn and never touch the user's saved file unless you ask for file.save.",
        input: objectSchema({
            op: { type: "string", description: "snapshot | list | restore | drop | mark | restore_mark | list_marks" },
            name: { type: "string", description: "Snapshot name or mark label." },
            note: { type: "string", description: "Optional note stored with the snapshot." },
            id: { type: "string", description: "Snapshot/mark id (prefix allowed)." },
            names: { type: "array", description: "Object names for mark; defaults to the current selection." },
        }, ["op"]),
        async execute(input) {
            return guarded(async () => {
                const op = str(input.op, "list").toLowerCase();
                const label = str(input.name);
                if (op === "snapshot") {
                    const id = stamp() + "-" + safeName(label || "snapshot", "snapshot");
                    const file = path.join(snapshotDir(host), id + ".blend");
                    const response = await host.bridge.call("save_snapshot", { filepath: file }, { timeoutMs: 180_000 });
                    const meta = {
                        id,
                        name: label || id,
                        note: str(input.note) || undefined,
                        at: Date.now(),
                        file,
                        size: Number(response.result.size || 0),
                    };
                    writeJson(path.join(snapshotDir(host), id + ".json"), meta);
                    return textResult(`snapshot ${id}\nfile: ${file}\nbytes: ${meta.size}`, { id, file });
                }
                if (op === "list") {
                    const all = listMeta(snapshotDir(host)).sort((a, b) => b.at - a.at);
                    return textResult(all.length
                        ? all.map((item) => `${item.id} · ${new Date(item.at).toISOString()} · ${item.name}${item.note ? " · " + item.note : ""}\n  ${item.file}`).join("\n")
                        : "No snapshots yet. Create one with op=snapshot before risky edits.");
                }
                if (op === "restore") {
                    const key = str(input.id) || label;
                    if (!key)
                        return errorResult("restore needs id or name");
                    const meta = findSnapshot(host, key);
                    if (!meta)
                        return errorResult("Snapshot not found: " + key);
                    const response = await host.bridge.call("open_blend", { filepath: meta.file }, { timeoutMs: 180_000 });
                    return textResult(`restored ${meta.id}\n${jsonText(response.result, 3000)}`, { id: meta.id });
                }
                if (op === "drop") {
                    const key = str(input.id) || label;
                    if (!key)
                        return errorResult("drop needs id or name");
                    const meta = findSnapshot(host, key);
                    if (!meta)
                        return errorResult("Snapshot not found: " + key);
                    try {
                        fs.unlinkSync(meta.file);
                    }
                    catch {
                        // ignore
                    }
                    try {
                        fs.unlinkSync(path.join(snapshotDir(host), meta.id + ".json"));
                    }
                    catch {
                        // ignore
                    }
                    return textResult(`dropped ${meta.id}`);
                }
                if (op === "mark") {
                    let names = Array.isArray(input.names) ? input.names.map(String) : [];
                    if (!names.length) {
                        const selection = await host.bridge.call("get_selection", {}, { timeoutMs: 10_000 });
                        names = Array.isArray(selection.result.selected) ? selection.result.selected : [];
                    }
                    if (!names.length)
                        return errorResult("Nothing to mark: pass names or select objects in Blender.");
                    const response = await host.bridge.call("get_marks", { names }, { timeoutMs: 15_000 });
                    const id = stamp() + "-" + safeName(label || "mark", "mark");
                    const meta = {
                        id,
                        label: label || id,
                        at: Date.now(),
                        marks: response.result.marks || {},
                    };
                    writeJson(path.join(markDir(host), id + ".json"), meta);
                    return textResult(`mark ${id} · ${Object.keys(meta.marks).length} objects\n${jsonText(meta.marks, 4000)}`, { id });
                }
                if (op === "restore_mark") {
                    const key = str(input.id) || label;
                    if (!key)
                        return errorResult("restore_mark needs id or name");
                    const meta = findMark(host, key);
                    if (!meta)
                        return errorResult("Mark not found: " + key);
                    const response = await host.bridge.call("restore_marks", { marks: meta.marks }, { timeoutMs: 30_000 });
                    return textResult(`restored mark ${meta.id}\n${jsonText(response.result, 3000)}`, { id: meta.id });
                }
                if (op === "list_marks") {
                    const all = listMeta(markDir(host)).sort((a, b) => b.at - a.at);
                    return textResult(all.length
                        ? all
                            .map((item) => `${item.id} · ${new Date(item.at).toISOString()} · ${item.label} · ${Object.keys(item.marks).length} objects`)
                            .join("\n")
                        : "No transform marks yet.");
                }
                return errorResult("Unknown op: " + op, "op is snapshot | list | restore | drop | mark | restore_mark | list_marks");
            });
        },
    };
}
