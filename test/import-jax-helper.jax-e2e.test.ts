/**
 * JAX-GATED end-to-end test for the LIVE JAX helper (scripts/extract/jax.py).
 *
 * WHY THIS EXISTS. The hand-authored JAX sidecar path (test/import-jax.test.ts)
 * proves the IMPORTER works on a manually written sidecar. It does NOT exercise
 * the helper's REAL emission path — scripts/extract/jax.py run through actual
 * JAX (jax.grad descent gradients, jax.make_jaxpr forensic digest, the pytree →
 * per-neuron-bias scalar mapping, the output-signal descent sign, optax-style
 * Adam m/v with the documented NON-flip). This test closes that gap, mirroring
 * test/import-pytorch-helper.torch-e2e.test.ts.
 *
 * WHAT IT DOES. For each supported optimizer on a bias=True 2-2-2 net it: runs
 * the live helper through real JAX -> sidecar -> importJaxSidecar /
 * importJaxSidecarStream -> reconcileReceipt / reconcileMultiStep, and asserts
 * the honest receipt is differentialPassed:true (Rule 14 — the engine
 * independently recomputes and AGREES) + reconcile ok:true. It also asserts the
 * checked-in frozen golden (fixtures/external/jax.sgd-live.sidecar.jsonl, a real
 * JAX-emitted sidecar) imports + passes Rule 14, and that boundary rejections
 * (x64-disabled / unsupported-optimizer / bad-topology) actually raise.
 *
 * DETERMINISM. The helper REFUSES to run unless jax_enable_x64 is True and the
 * device is CPU (the determinism contract). The probe enables x64 before
 * building params. CPU jax+jaxlib are pinned in
 * scripts/extract/requirements-jax-cpu.txt (PIN_PER_STEP).
 *
 * MODULE-NAME COLLISION (LOAD-BEARING). The helper file is scripts/extract/jax.py.
 * If scripts/extract were placed first on sys.path, `import jax` would resolve to
 * the HELPER instead of the JAX package (the file shadows the package). So the
 * probe loads the helper BY FILE PATH via importlib.util.spec_from_file_location
 * — scripts/extract is NEVER added to sys.path, so the helper's own `import jax`
 * resolves the real framework. (pytorch.py has no such collision: package=torch,
 * file=pytorch.py.)
 *
 * GATING. The whole suite skips when JAX is not importable (Node-only dev boxes /
 * Node-only CI jobs). Point BP_JAX_PYTHON at a python with CPU jax+jaxlib
 * installed to run it (the CI jax-e2e job sets it). Trust boundary unchanged: the
 * helper is an OBSERVER; Rule 14 is the authority — these tests assert the honest
 * path PASSES.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { importJaxSidecar, importJaxSidecarStream } from "../src/import-jax.js"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"

const REPO_ROOT = resolve(".")

/** Resolve a python interpreter that can `import jax`, or null to skip. */
function resolveJaxPython(): string | null {
  const candidates = [
    process.env.BP_JAX_PYTHON,
    // Local dev venv used during this wave (Windows + POSIX layouts).
    resolve(REPO_ROOT, "tmp/jax-venv/Scripts/python.exe"),
    resolve(REPO_ROOT, "tmp/jax-venv/Scripts/python"),
    resolve(REPO_ROOT, "tmp/jax-venv/bin/python"),
    "python3",
    "python",
  ].filter((c): c is string => typeof c === "string" && c.length > 0)
  for (const py of candidates) {
    const probe = spawnSync(py, ["-c", "import jax; print(jax.__version__)"], {
      encoding: "utf-8",
    })
    if (probe.status === 0 && /\d+\.\d+/.test(probe.stdout)) return py
  }
  return null
}

const JAX_PY = resolveJaxPython()
const SKIP = JAX_PY === null
const skipReason =
  "jax not importable — set BP_JAX_PYTHON to a python with CPU `jax`+`jaxlib` installed " +
  "(scripts/extract/requirements-jax-cpu.txt) to run the live JAX-helper end-to-end suite"

// Shared probe prelude: enable x64, load the helper BY PATH (collision-safe),
// build the Mazur-shaped 2-2-2 bias=True net.
const HELPER_PATH = JSON.stringify(resolve(REPO_ROOT, "scripts/extract/jax.py").replace(/\\/g, "/"))

// Python probe: runs N steps through the live helper, prints sidecar JSONL.
// Args: <optimizer> <steps> [softmax]
const PROBE = String.raw`
import sys, importlib.util
from pathlib import Path
import jax
jax.config.update("jax_enable_x64", True)
import jax.numpy as jnp

spec = importlib.util.spec_from_file_location("bp_jax_helper", Path(${HELPER_PATH}))
H = importlib.util.module_from_spec(spec); spec.loader.exec_module(H)

kind = sys.argv[1]
steps = int(sys.argv[2])
softmax = len(sys.argv) > 3 and sys.argv[3] == "softmax"

params = {
    "W_ih": jnp.array([[0.15,0.20],[0.25,0.30]], dtype=jnp.float64),
    "b_h":  jnp.array([0.35,0.45], dtype=jnp.float64),
    "W_ho": jnp.array([[0.40,0.45],[0.50,0.55]], dtype=jnp.float64),
    "b_o":  jnp.array([0.60,0.55], dtype=jnp.float64),
}
inputs = {"i1":0.6,"i2":0.9}
targets = {"o1":1.0,"o2":0.0} if softmax else {"o1":0.2,"o2":0.75}
topo_loss = "cross_entropy_softmax" if softmax else "half_squared_error"

class Cap:
    def __init__(self): self.buf=""; self.lines=[]
    def write(self,s):
        self.buf+=s
        while "\n" in self.buf:
            ln,self.buf=self.buf.split("\n",1)
            if ln: self.lines.append(ln)
        return len(s)
    def flush(self): pass

cap = Cap()
lr = 0.1 if kind=="adam" else 0.5
tid = "c"*32 if steps>1 else None
d = H.TraceDumper(params, optimizer=kind, learning_rate=lr, out=cap, trace_id=tid, topology_loss=topo_loss)
for _ in range(steps):
    with d.step(inputs=inputs, targets=targets) as ctx:
        params = ctx.run(params)
sys.stdout.write("\n".join(cap.lines))
`

// Python probe asserting a config RAISES HelperUnsupportedError. Args: <case>
const REJECT_PROBE = String.raw`
import sys, importlib.util
from pathlib import Path
import jax
import jax.numpy as jnp
case = sys.argv[1]
# x64 OFF only for the no_x64 case; ON for the others (so the rejection is the
# thing under test, not a stray x64 failure).
if case != "no_x64":
    jax.config.update("jax_enable_x64", True)
spec = importlib.util.spec_from_file_location("bp_jax_helper", Path(${HELPER_PATH}))
H = importlib.util.module_from_spec(spec); spec.loader.exec_module(H)
params = {
    "W_ih": jnp.array([[0.15,0.20],[0.25,0.30]]),
    "b_h":  jnp.array([0.35,0.45]),
    "W_ho": jnp.array([[0.40,0.45],[0.50,0.55]]),
    "b_o":  jnp.array([0.60,0.55]),
}
inputs={"i1":0.6,"i2":0.9}; targets={"o1":0.2,"o2":0.75}
try:
    if case == "no_x64":
        d = H.TraceDumper(params, optimizer="sgd", learning_rate=0.5, out=None)
    elif case == "adamw":
        d = H.TraceDumper(params, optimizer="adamw", learning_rate=0.1, out=None)
    elif case == "bad_topology":
        bad = {"W_ih": jnp.array([0.1,0.2]), "b_h": jnp.array([0.0]),
               "W_ho": jnp.array([[0.1]]), "b_o": jnp.array([0.0])}
        d = H.TraceDumper(bad, optimizer="sgd", learning_rate=0.5, out=None)
    else:
        print("UNKNOWN_CASE"); sys.exit(3)
    inputs2={"i1":0.6,"i2":0.9}; targets2={"o1":0.2,"o2":0.75}
    with d.step(inputs=inputs2, targets=targets2) as ctx:
        ctx.run(params)
    print("NOT_RAISED"); sys.exit(1)
except H.HelperUnsupportedError:
    print("RAISED"); sys.exit(0)
`

function runProbe(
  args: string[],
  probe: string,
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "bp-jax-e2e-"))
  const scriptPath = join(dir, "probe.py")
  try {
    writeFileSync(scriptPath, probe, "utf-8")
    const res = spawnSync(JAX_PY!, [scriptPath, ...args], {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    })
    return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- Supported optimizers: honest receipt MUST reconcile ok:true ------------

type Case = { name: string; steps: number; softmax: boolean }
const SUPPORTED: Case[] = [
  { name: "sgd", steps: 1, softmax: false },
  { name: "sgd", steps: 1, softmax: true }, // softmax+CE path
  { name: "adam", steps: 2, softmax: false },
]

for (const c of SUPPORTED) {
  const label = `${c.name}${c.softmax ? "+softmaxCE" : ""} (${c.steps} step${c.steps > 1 ? "s" : ""})`
  test(`live JAX helper end-to-end: ${label} bias=True -> reconcile ok:true`, { skip: SKIP && skipReason }, () => {
    const probeArgs = c.softmax ? [c.name, String(c.steps), "softmax"] : [c.name, String(c.steps)]
    const r = runProbe(probeArgs, PROBE)
    assert.equal(r.status, 0, `helper probe failed (${label}): ${r.stderr.slice(0, 600)}`)
    const bytes = r.stdout.trim()
    assert.ok(bytes.length > 0, `helper produced no sidecar bytes (${label})`)

    if (c.steps === 1) {
      const result = importJaxSidecar(bytes, {
        importTimestamp: "2026-06-01T00:00:00Z",
        differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
      })
      assert.equal(
        result.differentialPassed,
        true,
        `${label}: importer differential (Rule 14) must pass on the live helper's honest receipt; disagreements: ${JSON.stringify(result.differentialDisagreements.slice(0, 8))}`,
      )
      // bias=True must route to per_neuron + sgd (mirrors the torch helper G-015).
      assert.equal(result.receipt.topology?.bias_sharing, "per_neuron", `${label}: bias_sharing must be per_neuron`)
      assert.equal(result.receipt.bias_policy?.mode, "sgd", `${label}: bias_policy.mode must be sgd for an updating-bias model`)
      const rec = reconcileReceipt(result.receipt)
      assert.equal(
        rec.ok,
        true,
        `${label}: helper-emitted receipt must reconcile ok:true; failures: ${rec.ok ? "[]" : JSON.stringify(rec.failures.map((f) => ({ rule: f.rule, fp: f.field_path })).slice(0, 12))}`,
      )
    } else {
      const res = importJaxSidecarStream(bytes, {
        importTimestamp: "2026-06-01T00:00:00Z",
        differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
      })
      assert.equal(
        res.allDifferentialsPassed,
        true,
        `${label}: every step's differential (Rule 14) must pass; per-step disagreements: ${JSON.stringify(res.steps.flatMap((s) => s.differentialDisagreements).slice(0, 8))}`,
      )
      const receipts = res.steps.map((s) => s.receipt)
      assert.equal(receipts[0]!.bias_policy?.mode, "sgd", `${label}: bias_policy.mode must be sgd`)
      const multi = reconcileMultiStep(receipts)
      assert.equal(
        multi.ok,
        true,
        `${label}: multi-step reconcile must be ok:true; failures: ${multi.ok ? "[]" : JSON.stringify(multi.failures.map((f) => ({ rule: f.rule, fp: f.field_path })).slice(0, 12))}`,
      )
    }
  })
}

// --- Frozen golden: a REAL JAX-emitted sidecar checked into the repo ---------
// Imports + passes Rule 14 even on a box without JAX (Node-only). This is the
// honest-validation receipt: it was emitted by scripts/extract/jax.py running
// against real JAX 0.4.35 CPU x64, with only the forensic helper.extraction
// timestamp pinned for byte-stability (Rule 14 ignores the timestamp).
test("live JAX helper: frozen golden sidecar imports + passes Rule 14 (no JAX required)", () => {
  const goldenPath = resolve(REPO_ROOT, "fixtures/external/jax.sgd-live.sidecar.jsonl")
  assert.ok(existsSync(goldenPath), "fixtures/external/jax.sgd-live.sidecar.jsonl must exist")
  const bytes = readFileSync(goldenPath, "utf-8").trim()
  const result = importJaxSidecar(bytes, {
    importTimestamp: "2026-06-01T00:00:00Z",
    differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
  })
  assert.equal(
    result.differentialPassed,
    true,
    `frozen golden must pass Rule 14 differential; disagreements: ${JSON.stringify(result.differentialDisagreements.slice(0, 8))}`,
  )
  assert.equal(result.receipt.source_framework?.name, "jax", "golden source_framework.name must be jax")
  assert.equal(result.receipt.topology?.bias_sharing, "per_neuron", "golden must use per_neuron biases")
  const rec = reconcileReceipt(result.receipt)
  assert.equal(
    rec.ok,
    true,
    `frozen golden must reconcile ok:true; failures: ${rec.ok ? "[]" : JSON.stringify(rec.failures.map((f) => ({ rule: f.rule, fp: f.field_path })).slice(0, 12))}`,
  )
})

// --- Boundary rejections: MUST raise at extraction --------------------------

const REJECTIONS: Array<{ case: string; why: string }> = [
  { case: "no_x64", why: "jax_enable_x64 disabled — float32 would fail Rule 14 on FP drift" },
  { case: "adamw", why: "AdamW deferred — only sgd/adam supported live" },
  { case: "bad_topology", why: "non-2D weight arrays — single-hidden-layer feed-forward only" },
]

for (const rej of REJECTIONS) {
  test(`live JAX helper end-to-end: ${rej.case} REJECTED at extraction (HelperUnsupportedError)`, { skip: SKIP && skipReason }, () => {
    const r = runProbe([rej.case], REJECT_PROBE)
    assert.equal(
      r.status,
      0,
      `${rej.why}: expected the helper to RAISE HelperUnsupportedError (probe exit 0 == raised). stdout=${r.stdout.trim()} stderr=${r.stderr.slice(0, 400)}`,
    )
    assert.match(r.stdout, /RAISED/, `${rej.why}: probe must report RAISED`)
  })
}
