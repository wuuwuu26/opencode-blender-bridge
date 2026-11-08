import json
import socket
import sys
import time


def call(port, cmd, params=None, timeout=120.0):
    started = time.time()
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(json.dumps({"type": cmd, "params": params or {}}).encode("utf-8"))
        buf = b""
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
            try:
                return json.loads(buf.decode("utf-8")), round((time.time() - started) * 1000)
            except Exception:
                continue
    raise RuntimeError("no response for " + cmd)


if __name__ == "__main__":
    port = int(sys.argv[1])
    cmds = json.loads(sys.argv[2])
    for cmd in cmds:
        name = cmd["type"]
        params = cmd.get("params", {})
        resp, ms = call(port, name, params)
        print(name, ms, "ms", json.dumps(resp, ensure_ascii=False)[:1000], flush=True)
