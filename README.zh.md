<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
  <a href="https://mcp-tool-shop-org.github.io/backprop-trace/"><img alt="Landing Page" src="https://img.shields.io/badge/landing-page-blue.svg"></a>
</p>

一个用于神经网络训练步骤的确定性 26 条规则验证器。您向它提供一份记录，其中列出了导致一次梯度更新的所有因素；该协调器会重新推导所有声明，并在出现不一致时拒绝。遵循 Csmith/CompCert 系列中的“*预言机不得参考其所判断的对象*”原则。

> **v1.0.0 — 仅 CPU，确定性。** 该验证器涵盖 SGD、Adam、AdamW、SGD-momentum（经典/Nesterov/阻尼），以及 **与 L2 权重衰减相结合的 SGD**，共 26 条协调规则。实时 **PyTorch 和 JAX** 辅助工具将实际训练步骤提取到一个可验证的记录中——仅供观察者使用，[Rule 14](./docs/reconciliation.md) 是所有导入的辅助数据的权威。940 个确定性测试；验证器拥有的容差上限；反循环机制。请参阅 [`docs/live-helpers.md`](./docs/live-helpers.md)，然后再在生产环境中使用，并查看 [CHANGELOG](./CHANGELOG.md) 以了解版本历史记录。

## 30 秒快速入门

```bash
pnpm add @mcptoolshop/backprop-trace

# 1. Success path — verifier accepts a well-formed receipt
npx bp verify mazur
# exit 0 — schema + reconcile + engine-reproduce + byte-equal-vs-golden

# 2. Rejection path — verifier rejects a deliberately-broken receipt
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5
# (the fixture is broken on purpose; the verifier rejects it BEFORE
#  consulting fixture_status metadata — the anti-circularity ratchet)

# 3. Canonical bytes — what an attestation envelope would wrap
npx bp generate mazur | sha256sum
# 9-sig-fig canonical bytes (V8/Node 22.x) — in-toto v1 attestation seam
```

Mazur 2-2-2 是开放网络上引用最多的单步反向传播示例（[Matt Mazur，2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)）。其中的每个数字都可以手动推导。

## 这是什么

一个用于验证单个训练步骤的数值正确性验证器。协调器会执行 26 条规则，这些规则会根据指定的因素重新推导每个声明。如果任何规则在混合容差（`atol + rtol`）范围内出现不一致，则该记录将被拒绝。多步（规则 9 + 10）、批处理（规则 18 + 19）、Adam 动量循环（规则 22-24）、SGD 动量循环（规则 20 + 21a/21b/21c + 25 + 26）以及对导入框架跟踪的引擎重新计算差异（规则 14），涵盖了与生产相关的方面。

它**不**会验证整个训练过程，也不会证明模型是正确的，也不能替代实验跟踪器。它证明每个记录的步骤在数学上是一致的，并且链条是完整的。对抗性语料库证明了一个验证器的有效性（[Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)；[CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)）——每个规则都附带一个配对的错误测试用例，位于 [`fixtures/bad/`](./fixtures/bad) 中，验证器必须在读取任何 `fixture_status` 元数据之前拒绝该测试用例。

## 实时 PyTorch 辅助工具（v0.10+）

单个可审核的 Python 文件。出于设计原因，没有 pip 包——将其复制到您的仓库中，阅读它，运行它。

```bash
# 1. Install + copy the helper
pnpm add @mcptoolshop/backprop-trace
npx bp examples pytorch --print > pytorch_trace_helper.py

# 2. Wrap your training loop (5-line diff)
#    from pytorch_trace_helper import TraceDumper
#    dumper = TraceDumper(model, optimizer, loss_fn, out="trace.jsonl")
#    with dumper.step(inputs=..., targets=...):
#        optimizer.zero_grad(); loss.backward(); optimizer.step()
python my_train.py

# 3. Verify
npx bp import pytorch trace.jsonl | npx bp verify multi -
# exit 0 — clean · 1 — Rule violation · 2 — I/O error
```

该辅助工具会生成一个 `framework-trace.v0.7.0` 辅助数据文件，其中包含一个用于取证分析的 `helper` 块（名称、版本、源哈希值、框架版本、运行时、提取时间戳）。该块**不是凭据**——规则 14（引擎重新计算差异）是所有辅助工具生成的辅助数据的权威，无论辅助工具声明如何。篡改/错误/缺失的 `source_hash` 不会绕过规则 14。请参阅 [`docs/live-helpers.md`](./docs/live-helpers.md)，了解信任边界说明、禁止列表、9 个测试用例的对抗性目录以及无 pip 分发协议。

**支持**: PyTorch SGD + Adam + AdamW + sgd_momentum（经典/Nesterov/阻尼）+ **与 L2 权重衰减相结合的 SGD**，并具有 [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099) 中描述的 `momentum_buffer` 上升→下降符号翻转。首先支持 CPU。单步和多步。一个并行**实时 JAX 辅助工具**（`scripts/extract/jax.py`）涵盖了 SGD + Adam，并具有更强的信任边界——它将 `jax.make_jaxpr(jax.grad(loss))` 摘要折叠到用于取证分析的块中（可检查的梯度图，PyTorch 缺乏），并且在没有 `jax_enable_x64` + CPU 的情况下拒绝运行。请参阅 [`docs/live-helpers.md`](./docs/live-helpers.md)。
**边界处已拒绝**: AMP/autocast、CUDA/MPS/XLA、AMSGrad/NAdam/RAdam/Lion/LBFGS、多隐藏层拓扑。针对这些框架/优化器手动编写的辅助数据仍然可以通过标准的 `bp import` 路径工作。

## 这不是什么

- **不是实验跟踪器。** 使用 [MLflow](https://mlflow.org)、[Weights & Biases](https://wandb.ai)、[TensorBoard](https://www.tensorflow.org/tensorboard)——这些工具会记录声明；反向传播轨迹会重新推导数学是否在内部一致。
- **不是学习证明或 zkML。** [PoL](https://arxiv.org/abs/2103.05633) 已被证明可以在实际训练中进行伪造（[Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)）；zkML 会生成密码学证明。反向传播轨迹是非加密的、单步的，其受众是人类或 CI 审查员。
- **不是供应链证明。** [Sigstore 模型签名](https://github.com/sigstore/model-transparency)、[SLSA-for-models](https://slsa.dev)、[CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) 证明流水线的来源；反向传播轨迹证明数值的一致性。ML-BOM 可以将反向传播轨迹记录作为内部一致性谓词进行引用。

## 威胁模型

范围：任何应该被拒绝但却被接受的记录——模式绕过、NaN/Infinity 注入、规范化输出差异、违反反循环机制、对导入辅助数据的引擎重新计算差异。超出范围：训练过程本身的可靠性、对验证器进程的侧信道攻击。确定性是有限制的：只有在相同的反向传播轨迹版本、Node.js 22.x 和相同的规范化输出规范下，才能保证字节完全相同。请参阅 [SECURITY.md](./SECURITY.md)，了解完整的枚举 + 公开时间表。

## 安装

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

固定到 Node 22.x（V8 fdlibm `Math.exp` 确定性是关键——请参阅 [`docs/computation-order.md`](./docs/computation-order.md)）。

## CLI

完整参考：[`docs/cli.md`](./docs/cli.md)。

| 动词 | 目的 |
|---|---|
| `bp reconcile receipt <file>` | 运行所有 26 条规则；在第一次失败时退出，返回代码为 1。 |
| `bp verify mazur` | 对捆绑的 Mazur 测试用例进行全面测试 |
| `bp verify general <file>` | 通用门控器（v0.2+，支持：XOR、iris、softmax+CE、观察模式） |
| `bp verify multi <file.jsonl>` | 多条记录的 JSONL 文件 + 跨记录规则（9/10） |
| `bp generate {mazur,xor,iris}` | 重新运行指定的引擎，输出规范化的字节流 |
| `bp generate from-config <file>` | 从拓扑结构和输入 JSON 中重新运行引擎 |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | 编写一个起始的输入配置文件 |
| `bp validate-input <file>` | 对拓扑结构和输入配置文件进行模式验证 |
| `bp validate <file>` | 对凭证进行模式验证（自动检测 v0.1-v0.7 版本） |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | 导入外部框架的跟踪数据 |
| `bp examples {pytorch,jax} [--print]` | 打印捆绑的实时 PyTorch / JAX 辅助工具的路径（或输出其内容） |

常用标志：`--out <file>`、`--json`、`--verbose`/`-V`、`--color=auto\|never\|always`，文件参数 `-` 表示标准输入。退出代码：`0` 通过 · `1` 验证失败 · `2` 用法/I-O 错误 · `3` 无效的命令行参数 · `4` 未实现的框架。

## 库

```ts
import {
  reconcileReceipt, runMazurStep, MAZUR_INPUT,
  validateReceiptSchema, hashReceipt, verifyEngineReproduces,
  importPytorchSidecar, importJaxSidecar, importTensorflowSidecar,
} from '@mcptoolshop/backprop-trace';

const receipt = runMazurStep(MAZUR_INPUT);
const validated = validateReceiptSchema(receipt);    // schema gate
const result = reconcileReceipt(receipt);             // 26-rule internal-consistency gate
const sha = hashReceipt(receipt);                     // in-toto seam
const repro = verifyEngineReproduces(receipt);        // engine-reproduce: re-derives from inputs

const { receipt: imported, differentialPassed } =
  importPytorchSidecar(sidecarBytes);                 // observer-mode + Rule 14
```

> **哪个门控器证明了什么？** `reconcileReceipt` 证明凭证中的数学计算是
> *内部一致的*（26 条规则从凭证自身的因素中重新推导出每个声明）。对于一个**来源未知的**凭证，将其与引擎重现门控器配对——`verifyEngineReproduces`（或 `bp verify general`），该门控器会从凭证的输入中重新运行确定性引擎，并逐字段进行比较。第二个门控器可以防止循环依赖：仅内部一致性无法检测到已被重新标记为由引擎生成的外部凭证，因为没有针对每个凭证的规则会重新推导出引擎生成凭证的正向传递过程。观察模式导入（`importPytorchSidecar`）会自动运行引擎重现差异（规则 14）；`bp verify` 始终运行这两个门控器。

子路径导入：`./reconcile`、`./engine`、`./general-engine`、`./mazur`、`./topology`、`./activations`、`./emit`、`./validate`、`./parse`、`./parse-input`、`./hash`、`./schema-loader`、`./verify-engine`、`./extract`、`./import-pytorch`、`./import-jax`、`./import-tensorflow`、`./import-observer`，以及模式系列 `./schema/...`。

## 26 条规则

完整语句 + 对抗性测试用例：[`docs/reconciliation.md`](./docs/reconciliation.md)。

| # | 规则 |
|---|---|
| 0 | 结构失败哨兵（模式级别） |
| 0.8 | 概率边界——softmax 输出在 [0, 1] 范围内 |
| 1-4 | 错误信号（输出、下游、隐藏层）+ 更新梯度一致性 |
| 5-7 | 更新值、权重进展、最终状态（AdamW 分支应用于规则 6/7，实现解耦的权重衰减） |
| 8 | 来源参考一致性 |
| 9-10 | 多步参数链 + 跟踪标识 |
| 11-13 | Softmax 归一化 + 损失公式 + 双形式（GATED） |
| 14 | 引擎重新计算差异（观察模式导入时必须启用） |
| 15-17 | 跳跃基准 + 带符号摘要绑定 + 包根绑定（GATED） |
| 18-19 | 批处理减少一致性 + 样本集相干性（GATED） |
| 20 | 优化器状态形状（Adam `{m, v}` / sgd_momentum `{buffer}`） |
| 21 | **PyTorch 风格的 SGD 动量**: 21a buffer 递归 + 21b 有效方向 + 21c 参数更新 |
| 22-24 | Adam 矩递归 + 偏差校正 + 参数更新（epsilon 在平方根之外） |
| 25-26 | 多步优化器状态链 + 优化器配置一致性 |

## 确定性范围

合同约束：Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.12.x：字节级别的黄金标准（Mazur、XOR、iris、softmax+CE、多步、批处理、外部侧边栏）；Mazur 基准 `post_update_loss.total = 0.29102777369359933`；在 `atol=1e-12` 和 `rtol=1e-9` 的范围内进行规则级别的协调，用于引擎生成的凭证。

不属于合同约束：跨引擎（Bun、Deno、浏览器）；跨 Node 主要版本（24.x+）；任意 V8 次要版本更新。每个 CI 单元都会触发一个 `Math.exp(-0.5)` canary 测试，作为 V8 fdlibm 漂移警报。

## 此版本中未包含的内容（尚未）

v1.0.0 涵盖了确定性 CPU 的端到端流程：引擎、协调器、规范化输出合同、外部导入路径、实时 PyTorch **和** JAX 辅助工具、SGD 系列优化器，包括耦合的 L2 权重衰减、一个可识别的主测试用例以及一个有效的 [合规包](./docs/compliance.md)。以下路线图描述了**尚未涵盖的内容**——按使用频率 × 验证可行性排序，每个都依赖于一个封闭形式的 CPU 重计算，协调器可以实际拥有：

- **NAdam（可选 RAdam）**——廉价的 Adam 变体。然后是**学习率调度验证**，它与每个优化器一起使用。*接下来。*
- **AMSGrad / 全局范数梯度裁剪 / 每组学习率 / Lion**——每个都通过一个收据/对账扩展进行控制。*稍后。*
- **卷积 / 多隐藏层拓扑**——引擎是单隐藏层的密集层；核心组件是一个可识别的密集 ReLU→softmax 分类器。卷积引入了融合内核 FP 排序，以对抗位确定性（参见下面的 GPU）。*可能脱离 CPU 确定性的范围。*
- **异构多框架跟踪**——仅支持单个框架的捆绑包；不支持混合框架流。*可能会超出范围。*
- **跨步骤的异构批大小**——每个流的批大小固定。*可能会超出范围。*
- **批量收据中逐样本的梯度**——今天只减少梯度；逐样本分解对于影响审计很有用，但尚未公开。*稍后。*
- **多步跟踪上的生产者身份绑定**——规则 17 检测捆绑包完整性失败，而不是生产者真实性。与规则 16 / Sigstore / 非同步证明结合使用。操作器表面，不是内置的。
- **GPU / 融合内核位确定性**——超出范围且永久存在。浮点数的非结合性使得在融合/并行内核中实现完全一致性变得不可能（[arXiv:2408.05148](https://arxiv.org/abs/2408.05148)；cuDNN ConvolutionBackwardFilter 原子操作，参见 [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)）。结果是确定性的 CPU 范围。

如果您的工作流程依赖于其中任何一项，那么这还不是适合您使用的版本。

## 编写自定义拓扑

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

请参阅 [`docs/authoring.md`](./docs/authoring.md)——输入与收据模式、规范化输出信任边界。

## 这如何应用

- **首先关注可重复性的论文作者**（NeurIPS/ICML/CoLLAs；[REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452) 意识）——可以重新推导的每一步证据，由审查者在 30 秒内运行。
- **机器学习教学**（Karpathy 从零开始、大学深度学习课程、面试准备）——一个具有所有可见因素的命名训练步骤和一个*拒绝*故意损坏组件的对账器。
- **机器学习框架/编译器工程师**（PyTorch / JAX / MLIR / XLA 贡献者）——用于差异测试的已知良好的每操作跟踪。
- **机器学习合规性/审计工程师**（[欧盟人工智能法案附件 IV §2(g) 验证/测试日志 + 第 15 条鲁棒性](https://artificialintelligenceact.eu/annex/4/)；SLSA-for-ML）——每一步的收据，作为可验证、带日期、可签名的测试日志记录，用于模型签名。请参阅已完成的[合规捆绑包](./docs/compliance.md)（以及诚实的范围：收据证明*数学*，而不是数据治理）。

## 法律框架

来自 `docs/canonical-emission.md`：

> 合约先于引擎。格式化策略先于运行时格式化。不良收据先于良好收据。运行时格式化先于 Mazur。Mazur 先于诊断。

## 链接

- [`docs/quickstart.md`](./docs/quickstart.md)——五分钟快速入门
- [`docs/cli.md`](./docs/cli.md)——`bp` 子命令参考
- [`docs/live-helpers.md`](./docs/live-helpers.md)——v0.10 实时 PyTorch 助手：工作流程、信任边界、对抗目录、无需 pip 的原因
- [`docs/authoring.md`](./docs/authoring.md)——编写自定义拓扑
- [`docs/reconciliation.md`](./docs/reconciliation.md)——完整的 26 条对账规则
- [`docs/topology.md`](./docs/topology.md)——通用拓扑编写
- [`docs/multi-step.md`](./docs/multi-step.md)——多步训练收据
- [`docs/canonical-emission.md`](./docs/canonical-emission.md)——字节级编码合同
- [`docs/computation-order.md`](./docs/computation-order.md)——IEEE 754 排序；FMA 禁止；确定性边界
- [`docs/schema.md`](./docs/schema.md)——逐字段模式快速入门
- [`docs/attestation.md`](./docs/attestation.md)——in-toto v1 证明接口
- [`CONTRIBUTING.md`](./CONTRIBUTING.md)——反循环棘轮；不良收据先于良好原则
- [`SECURITY.md`](./SECURITY.md)——对于验证者而言，什么构成漏洞
- [`CHANGELOG.md`](./CHANGELOG.md)——按版本历史记录

## 许可证

MIT ——请参阅 [LICENSE](./LICENSE)。

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
