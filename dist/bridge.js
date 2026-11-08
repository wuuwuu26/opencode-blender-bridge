import net from "node:net";
export class BridgeError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.name = "BridgeError";
        this.code = code;
        this.detail = detail;
    }
}
export class BridgeClient {
    host;
    port;
    constructor(host, port) {
        this.host = host;
        this.port = port;
    }
    async call(type, params = {}, options = {}) {
        const timeoutMs = Math.max(250, options.timeoutMs ?? 120_000);
        const started = Date.now();
        return new Promise((resolve, reject) => {
            if (options.signal?.aborted) {
                reject(new BridgeError("aborted", "Tool call was aborted"));
                return;
            }
            const socket = net.connect({ host: this.host, port: this.port });
            let buffer = "";
            let settled = false;
            let timer;
            const finish = (fn) => {
                if (settled)
                    return;
                settled = true;
                if (timer)
                    clearTimeout(timer);
                options.signal?.removeEventListener("abort", onAbort);
                try {
                    socket.destroy();
                }
                catch {
                    // already closed
                }
                fn();
            };
            const onAbort = () => finish(() => reject(new BridgeError("aborted", "Tool call was aborted")));
            timer = setTimeout(() => finish(() => reject(new BridgeError("timeout", `Blender did not answer ${type} within ${timeoutMs} ms (port ${this.port})`))), timeoutMs);
            options.signal?.addEventListener("abort", onAbort, { once: true });
            socket.once("connect", () => {
                try {
                    socket.write(JSON.stringify({ type, params }));
                }
                catch (error) {
                    finish(() => reject(new BridgeError("unreachable", String(error))));
                }
            });
            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
                let parsed;
                try {
                    parsed = JSON.parse(buffer);
                }
                catch {
                    return;
                }
                finish(() => {
                    const record = parsed;
                    if (record.status === "error") {
                        const message = String(record.message || record.error || "Blender add-on returned an error");
                        reject(new BridgeError("addon_error", message, record));
                        return;
                    }
                    if (record.status !== "success") {
                        reject(new BridgeError("bad_response", "Unexpected response from Blender: " + buffer.slice(0, 500)));
                        return;
                    }
                    resolve({ result: (record.result ?? {}), ms: Date.now() - started });
                });
            });
            socket.once("error", (error) => {
                const code = error.code === "ECONNREFUSED" || error.code === "EHOSTUNREACH" ? "unreachable" : "unreachable";
                finish(() => reject(new BridgeError(code, `No Blender bridge on ${this.host}:${this.port} (${error.code || error.message}). ` +
                    `Start Blender, open the OpenCode sidebar panel and press Connect.`)));
            });
            socket.once("close", () => {
                if (!settled && !buffer) {
                    finish(() => reject(new BridgeError("bad_response", "Blender closed the connection without a response")));
                }
            });
        });
    }
    async ping(timeoutMs = 1500) {
        try {
            await this.call("ping", {}, { timeoutMs });
            return true;
        }
        catch {
            return false;
        }
    }
    async info(timeoutMs = 4000) {
        const { result } = await this.call("get_addon_info", {}, { timeoutMs });
        return result;
    }
}
