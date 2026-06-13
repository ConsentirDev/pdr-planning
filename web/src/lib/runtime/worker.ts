/// <reference lib="webworker" />
// Pyodide worker: loads the WASM Python runtime, installs the real `pdr` wheel,
// and runs `pdr.web.run_trace`. This is the genuine, verified planner running
// client-side — no server, no reimplementation.

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs";

let pyodide: any = null;
let ready: Promise<void> | null = null;

async function init(wheelUrl: string) {
  // @vite-ignore — load Pyodide from CDN at runtime (not bundled)
  const mod: any = await import(/* @vite-ignore */ PYODIDE_URL);
  pyodide = await mod.loadPyodide({
    indexURL: PYODIDE_URL.replace("/pyodide.mjs", "/"),
  });
  post({ type: "status", message: "installing pdr…" });
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  await micropip.install(wheelUrl);
  // warm the import so the first real run is fast.
  // NB: `import pdr.web` binds the top-level name `pdr` (so `pdr.web.x` resolves);
  // `import pdr.web as _w` would bind only `_w` and leave `pdr` undefined.
  pyodide.runPython("import pdr.web");
  post({ type: "ready" });
}

function post(m: any) {
  (self as any).postMessage(m);
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      if (!ready) {
        post({ type: "status", message: "booting python…" });
        ready = init(msg.wheelUrl);
      }
      await ready;
      return;
    }
    if (msg.type === "run") {
      if (!ready) throw new Error("runtime not initialised");
      await ready;
      const spec = JSON.stringify(msg.spec);
      pyodide.globals.set("__spec_json", spec);
      const out = pyodide.runPython(
        "pdr.web.run_trace_json(__spec_json)"
      ) as string;
      post({ type: "result", id: msg.id, trace: JSON.parse(out) });
    }
  } catch (err: any) {
    post({ type: "error", id: msg.id, message: String(err?.message || err) });
  }
};
