import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export function str(value, fallback = "") {
    if (typeof value === "string")
        return value;
    if (value === undefined || value === null)
        return fallback;
    return String(value);
}
export function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
export function bool(value, fallback = false) {
    if (value === undefined || value === null || value === "")
        return fallback;
    if (typeof value === "string")
        return !["0", "false", "no", "off"].includes(value.toLowerCase());
    return Boolean(value);
}
export function vec3(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (Array.isArray(value)) {
        const nums = value.slice(0, 3).map((v) => Number(v));
        if (nums.length >= 3 && nums.every(Number.isFinite))
            return nums;
        return undefined;
    }
    if (typeof value === "string") {
        const nums = value
            .replace(/[()[\]]/g, "")
            .split(/[,\s]+/)
            .filter(Boolean)
            .map(Number);
        if (nums.length >= 3 && nums.every(Number.isFinite))
            return nums.slice(0, 3);
    }
    return undefined;
}
export function truncate(value, max = 6000) {
    if (value.length <= max)
        return value;
    return value.slice(0, max) + `\n… (${value.length - max} chars truncated)`;
}
export function jsonText(value, max = 6000) {
    let text;
    try {
        text = JSON.stringify(value, null, 2);
    }
    catch {
        text = String(value);
    }
    return truncate(text, max);
}
export function stamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}
export function safeName(value, fallback = "item") {
    const cleaned = value
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return cleaned || fallback;
}
export function lookPath(name) {
    const paths = (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
    const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of paths) {
        for (const ext of exts) {
            const candidate = path.join(dir, name + (name.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext));
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
                    return candidate;
            }
            catch {
                // ignore inaccessible PATH entries
            }
        }
    }
    return undefined;
}
export function fileUri(file) {
    return pathToFileURL(path.resolve(file)).href;
}
export function hashFile(file) {
    try {
        const hash = crypto.createHash("sha1");
        hash.update(fs.readFileSync(file));
        return hash.digest("hex").slice(0, 16);
    }
    catch {
        return "";
    }
}
export function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return fallback;
    }
}
export function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
export function tempRoot() {
    return ensureDir(path.join(os.tmpdir(), "opencode-blender-bridge"));
}
export function projectKey(dir) {
    return crypto.createHash("sha1").update(path.resolve(dir).toLowerCase()).digest("hex").slice(0, 12);
}
export function pick(input, mapping) {
    const out = {};
    for (const [from, to] of Object.entries(mapping)) {
        if (input[from] !== undefined)
            out[to] = input[from];
    }
    return out;
}
export function errorText(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "string")
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
export function tail(file, lines = 30) {
    try {
        const text = fs.readFileSync(file, "utf8");
        return text.split(/\r?\n/).slice(-lines).join("\n").trim();
    }
    catch {
        return "";
    }
}
