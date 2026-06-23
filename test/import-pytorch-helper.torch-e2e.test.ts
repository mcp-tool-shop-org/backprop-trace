/**
 * G-017 — TORCH-GATED end-to-end test for the LIVE PyTorch helper.
 *
 * WHY THIS EXISTS. Every other helper test reads HAND-AUTHORED sidecars (or
 * fixtures derived from them). That left the helper's REAL emission path —
 * scripts/extract/pytorch.py run through actual torch — completely unverified.
 * Six latent bugs hid there (all caught by this path): per-neuron bias
 * structure, the [error_signal, upstream] factor decomposition (vs a bogus
 * [learning_rate, gradient]), the ascent->descent output-signal sign, the Adam
 * `step`-field schema violation, the Adam `m` sign flip, and AdamW's
 * decoupled-update semantics — plus an importer gap (Nesterov/dampening not
 * forwarded to the differential recompute).
 *
 * WHAT IT DOES. For each supported optimizer on a bias=True model it: runs the
 * live helper through real torch -> sidecar -> importPytorchSidecar /
 * importPytorchSidecarStream -> reconcileReceipt / reconcileMultiStep, and
 * asserts the honest receipt is ok:true (engine_recompute_matched). It also
 * asserts the boundary REJECTIONS (amsgrad / maximize / dampening /
 * multi-param-group) actually raise.
 *
 * GATING. The whole suite skips when torch is not importable (Node-only dev
 * boxes / Node-only CI jobs). Point BP_TORCH_PYTHON at a python with torch+cpu
 * installed to run it (the CI torch job sets it / puts torch on the default
 * `python3`). Trust boundary unchanged: the helper is an OBSERVER; Rule 14 is
 * the authority — these tests assert the honest path PASSES, the bad-fixture +
 * boundary-rejection tests assert dishonest paths FAIL.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"

const REPO_ROOT = resolve(".")

/** Resolve a python interpreter that can `import torch`, or null to skip. */
function resolveTorchPython(): string | null {
  const candidates = [
    process.env.BP_TORCH_PYTHON,
    // Local dev venv used during this wave (Windows + POSIX layouts).
    resolve(REPO_ROOT, "tmp/torch-venv/Scripts/python.exe"),
    resolve(REPO_ROOT, "tmp/torch-venv/Scripts/python"),
    resolve(REPO_ROOT, "tmp/torch-venv/bin/python"),
    "python3",
    "python",
  ].filter((c): c is string => typeof c === "string" && c.length > 0)
  for (const py of candidates) {
    const probe = spawnSync(py, ["-c", "import torch; print(torch.__version__)"], {
      encoding: "utf-8",
    })
    if (probe.status === 0 && /\d+\.\d+/.test(probe.stdout)) return py
  }
  return null
}

const TORCH_PY = resolveTorchPython()
const SKIP = TORCH_PY === null
const skipReason =
  "torch not importable — set BP_TORCH_PYTHON to a python with `pip install torch` (CPU) to run the live-helper end-to-end suite"

// Python probe: builds a bias=True 2-2-2 model, runs N steps through the live
// helper, prints the sidecar JSONL to stdout. Args: <optimizer> <steps> [softmax]
const PROBE = String.raw`
import sys, json
from pathlib import Path
HELPER_DIR = Path(${JSON.stringify(resolve(REPO_ROOT, "scripts/extract").replace(/\\/g, "/"))})
sys.path.insert(0, str(HELPER_DIR))
import torch, torch.nn as nn
import pytorch as H

torch.manual_seed(11)
torch.set_default_dtype(torch.float64)

kind = sys.argv[1]
steps = int(sys.argv[2])
softmax = len(sys.argv) > 3 and sys.argv[3] == "softmax"

out_act = nn.Softmax(dim=-1) if softmax else nn.Sigmoid()
model = nn.Sequential(nn.Linear(2,2,bias=True), nn.Sigmoid(), nn.Linear(2,2,bias=True), out_act)
with torch.no_grad():
    model[0].weight.copy_(torch.tensor([[0.15,0.20],[0.25,0.30]], dtype=torch.float64))
    model[2].weight.copy_(torch.tensor([[0.40,0.45],[0.50,0.55]], dtype=torch.float64))
    model[0].bias.copy_(torch.tensor([0.35,0.45], dtype=torch.float64))
    model[2].bias.copy_(torch.tensor([0.60,0.55], dtype=torch.float64))

inputs = {"i1":0.6,"i2":0.9}
targets = {"o1":1.0,"o2":0.0} if softmax else {"o1":0.2,"o2":0.75}
x = torch.tensor([[inputs["i1"],inputs["i2"]]], dtype=torch.float64)
y = torch.tensor([[targets["o1"],targets["o2"]]], dtype=torch.float64)

if softmax:
    def loss_fn(o,t):
        return -(t*torch.log(o+1e-30)).sum()
    topo_loss = "cross_entropy_softmax"
else:
    loss_fn = lambda o,t: 0.5*((o-t)**2).sum()
    topo_loss = "half_squared_error"

opts = {
    "sgd": lambda: torch.optim.SGD(model.parameters(), lr=0.5),
    "sgd_momentum": lambda: torch.optim.SGD(model.parameters(), lr=0.5, momentum=0.9),
    "sgd_nesterov": lambda: torch.optim.SGD(model.parameters(), lr=0.5, momentum=0.9, nesterov=True),
    # v0.13 — SGD coupled L2 (the Rule 7 third branch): weight_decay folds into
    # the gradient before the update/buffer. DISTINCT from AdamW's decoupled decay.
    "sgd_wd": lambda: torch.optim.SGD(model.parameters(), lr=0.5, weight_decay=0.01),
    "sgd_momentum_wd": lambda: torch.optim.SGD(model.parameters(), lr=0.5, momentum=0.9, weight_decay=0.01),
    "adam": lambda: torch.optim.Adam(model.parameters(), lr=0.1),
    "adamw": lambda: torch.optim.AdamW(model.parameters(), lr=0.1, weight_decay=0.05),
}
opt = opts[kind]()

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
tid = "b"*32 if steps>1 else None
d = H.TraceDumper(model, opt, loss_fn, out=cap, trace_id=tid, topology_loss=topo_loss)
for _ in range(steps):
    with d.step(inputs=inputs, targets=targets):
        opt.zero_grad(); l=loss_fn(model(x),y); l.backward(); opt.step()
sys.stdout.write("\n".join(cap.lines))
`

// Python probe that asserts a flag/config RAISES HelperUnsupportedError.
const REJECT_PROBE = String.raw`
import sys
from pathlib import Path
HELPER_DIR = Path(${JSON.stringify(resolve(REPO_ROOT, "scripts/extract").replace(/\\/g, "/"))})
sys.path.insert(0, str(HELPER_DIR))
import torch, torch.nn as nn
import pytorch as H
torch.set_default_dtype(torch.float64)
case = sys.argv[1]
def model():
    return nn.Sequential(nn.Linear(2,2,bias=True), nn.Sigmoid(), nn.Linear(2,2,bias=True), nn.Sigmoid())
m = model()
if case == "amsgrad":
    opt = torch.optim.Adam(m.parameters(), lr=0.1, amsgrad=True)
elif case == "maximize":
    opt = torch.optim.SGD(m.parameters(), lr=0.5, maximize=True)
elif case == "dampening":
    opt = torch.optim.SGD(m.parameters(), lr=0.5, momentum=0.9, dampening=0.1)
elif case == "two_groups":
    opt = torch.optim.SGD([{"params": list(m[0].parameters()), "lr":0.5},
                           {"params": list(m[2].parameters()), "lr":0.1}])
else:
    print("UNKNOWN_CASE"); sys.exit(3)
inputs={"i1":0.6,"i2":0.9}; targets={"o1":0.2,"o2":0.75}
x=torch.tensor([[0.6,0.9]]); y=torch.tensor([[0.2,0.75]])
loss_fn=lambda o,t:0.5*((o-t)**2).sum()
try:
    d=H.TraceDumper(m,opt,loss_fn,out=None,trace_id=None)
    with d.step(inputs=inputs,targets=targets):
        opt.zero_grad(); l=loss_fn(m(x),y); l.backward(); opt.step()
    print("NOT_RAISED"); sys.exit(1)
except H.HelperUnsupportedError as e:
    print("RAISED"); sys.exit(0)
`

function runProbe(args: string[], probe: string): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "bp-torch-e2e-"))
  const scriptPath = join(dir, "probe.py")
  try {
    writeFileSync(scriptPath, probe, "utf-8")
    const res = spawnSync(TORCH_PY!, [scriptPath, ...args], { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 })
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
  { name: "sgd_momentum", steps: 2, softmax: false },
  { name: "sgd_nesterov", steps: 2, softmax: false },
  // v0.13 — SGD coupled L2 (the documented Rule 7 third branch).
  { name: "sgd_wd", steps: 1, softmax: false },
  { name: "sgd_momentum_wd", steps: 2, softmax: false },
  { name: "adam", steps: 2, softmax: false },
  { name: "adamw", steps: 2, softmax: false },
]

for (const c of SUPPORTED) {
  const label = `${c.name}${c.softmax ? "+softmaxCE" : ""} (${c.steps} step${c.steps > 1 ? "s" : ""})`
  test(`live helper end-to-end: ${label} bias=True -> reconcile ok:true`, { skip: SKIP && skipReason }, () => {
    const probeArgs = c.softmax ? [c.name, String(c.steps), "softmax"] : [c.name, String(c.steps)]
    const r = runProbe(probeArgs, PROBE)
    assert.equal(r.status, 0, `helper probe failed (${label}): ${r.stderr.slice(0, 600)}`)
    const bytes = r.stdout.trim()
    assert.ok(bytes.length > 0, `helper produced no sidecar bytes (${label})`)

    if (c.steps === 1) {
      const result = importPytorchSidecar(bytes, {
        importTimestamp: "2026-06-01T00:00:00Z",
        differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
      })
      assert.equal(
        result.differentialPassed,
        true,
        `${label}: importer differential (Rule 14) must pass on the live helper's honest receipt; disagreements: ${JSON.stringify(result.differentialDisagreements.slice(0, 8))}`,
      )
      // bias=True must route to per_neuron + sgd (G-015).
      assert.equal(result.receipt.topology?.bias_sharing, "per_neuron", `${label}: bias_sharing must be per_neuron`)
      assert.equal(result.receipt.bias_policy?.mode, "sgd", `${label}: bias_policy.mode must be sgd for an updating-bias model`)
      const rec = reconcileReceipt(result.receipt)
      assert.equal(
        rec.ok,
        true,
        `${label}: helper-emitted receipt must reconcile ok:true; failures: ${rec.ok ? "[]" : JSON.stringify(rec.failures.map((f) => ({ rule: f.rule, fp: f.field_path })).slice(0, 12))}`,
      )
    } else {
      const res = importPytorchSidecarStream(bytes, {
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

// --- bias=False model: constant-bias path, no bias updates ------------------

const BIAS_FALSE_PROBE = String.raw`
import sys, json
from pathlib import Path
HELPER_DIR = Path(${JSON.stringify(resolve(REPO_ROOT, "scripts/extract").replace(/\\/g, "/"))})
sys.path.insert(0, str(HELPER_DIR))
import torch, torch.nn as nn
import pytorch as H
torch.manual_seed(5); torch.set_default_dtype(torch.float64)
m = nn.Sequential(nn.Linear(2,2,bias=False), nn.Sigmoid(), nn.Linear(2,2,bias=False), nn.Sigmoid())
opt = torch.optim.SGD(m.parameters(), lr=0.5)
inputs={"i1":0.5,"i2":0.2}; targets={"o1":0.3,"o2":0.7}
x=torch.tensor([[0.5,0.2]]); y=torch.tensor([[0.3,0.7]])
loss_fn=lambda o,t:0.5*((o-t)**2).sum()
class Cap:
    def __init__(self): self.buf=""; self.lines=[]
    def write(self,s):
        self.buf+=s
        while "\n" in self.buf:
            ln,self.buf=self.buf.split("\n",1)
            if ln: self.lines.append(ln)
        return len(s)
    def flush(self): pass
cap=Cap()
d=H.TraceDumper(m,opt,loss_fn,out=cap,trace_id=None)
with d.step(inputs=inputs,targets=targets):
    opt.zero_grad(); l=loss_fn(m(x),y); l.backward(); opt.step()
sys.stdout.write("\n".join(cap.lines))
`

test("live helper end-to-end: bias=False SGD -> constant-bias path reconciles ok:true", { skip: SKIP && skipReason }, () => {
  const r = runProbe([], BIAS_FALSE_PROBE)
  assert.equal(r.status, 0, `bias=False probe failed: ${r.stderr.slice(0, 600)}`)
  const result = importPytorchSidecar(r.stdout.trim(), {
    importTimestamp: "2026-06-01T00:00:00Z",
    differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
  })
  assert.equal(result.differentialPassed, true, `bias=False differential must pass; ${JSON.stringify(result.differentialDisagreements.slice(0, 6))}`)
  // No bias changed -> importer keeps mode='constant'.
  assert.equal(result.receipt.bias_policy?.mode, "constant", "bias=False must route to bias_policy.mode='constant'")
  const rec = reconcileReceipt(result.receipt)
  assert.equal(rec.ok, true, `bias=False receipt must reconcile ok:true; failures: ${rec.ok ? "[]" : JSON.stringify(rec.failures.map((f) => ({ rule: f.rule, fp: f.field_path })).slice(0, 8))}`)
})

// --- Boundary rejections: G-016 / G-034 MUST raise at extraction ------------

const REJECTIONS: Array<{ case: string; why: string }> = [
  { case: "amsgrad", why: "Adam(amsgrad=True) — AMSGrad max-of-v not modeled" },
  { case: "maximize", why: "SGD(maximize=True) — ascent step" },
  { case: "dampening", why: "SGD(dampening!=0) — PyTorch skips dampening on the first step" },
  { case: "two_groups", why: "multiple param_groups — only param_groups[0] is read" },
]

for (const rej of REJECTIONS) {
  test(`live helper end-to-end: ${rej.case} REJECTED at extraction (HelperUnsupportedError)`, { skip: SKIP && skipReason }, () => {
    const r = runProbe([rej.case], REJECT_PROBE)
    assert.equal(
      r.status,
      0,
      `${rej.why}: expected the helper to RAISE HelperUnsupportedError (probe exit 0 == raised). stdout=${r.stdout.trim()} stderr=${r.stderr.slice(0, 400)}`,
    )
    assert.match(r.stdout, /RAISED/, `${rej.why}: probe must report RAISED`)
  })
}
