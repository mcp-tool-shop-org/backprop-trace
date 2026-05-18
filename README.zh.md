<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

这是一种用于验证单个神经网络训练步骤的确定性结构化追溯工具，它包含 16 条规则，用于重新推导梯度、信号和参数更新，这些信息来自命名的因素，并生成符合标准的、以字节为单位的 JSONL 格式的验证报告。它遵循 Csmith/CompCert 的原则：“验证器不应参考它所评估的工件”。

**状态：v0.7.0 (mid-v0)。** 核心引擎和验证器已经实现并可以发布。支持单步、仅 CPU、仅 SGD 和单样本。目前，外部框架的追溯信息是手动编写的辅助文件。在将此工具用于生产环境之前，请参阅“[此版本中未包含的内容](#whats-not-in-this-version-yet)”。

## 30 秒快速入门

```bash
pnpm add @mcptoolshop/backprop-trace

# 1. Success path — the verifier accepts a well-formed receipt
npx bp verify mazur
# exit 0 — 16 rules pass on the bundled Mazur 2-2-2 fixture
#          (schema + reconcile + engine-reproduce + byte-equal-vs-golden)

# 2. Rejection path — the verifier rejects a deliberately-broken receipt
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5
# (the fixture is broken on purpose; the verifier must reject it
#  BEFORE consulting fixture_status metadata — the anti-circularity ratchet)

# 3. Canonical bytes — what an attestation envelope would wrap
npx bp generate mazur | sha256sum
# 9-sig-fig canonical bytes (V8/Node 22.x) — in-toto v1 attestation seam
```

Mazur 的 2-2-2 示例是关于反向传播的、在公开网络上引用最多的单步教程（Matt Mazur，2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/))。它是一个重要的示例，因为其中的每一个数字都可以手动推导。要了解您自己的追溯过程，请参阅“[提供您自己的训练追溯](#bring-your-own-training-trace)”。

## 这是什么

`backprop-trace` 是一个用于验证*单个*神经网络训练步骤的数值正确性工具。您向它提供一个验证报告，该报告是 JSONL 格式的记录，其中命名了所有对单个梯度更新做出贡献的因素。然后，验证器会根据 16 条规则，从命名的因素重新推导每个声明。如果任何规则的结果与混合容差（`atol + rtol`，对称最大值形式）不一致，则会拒绝该验证报告。

其理论基础是 Csmith（Yang, Chen, Eide, Regehr — PLDI 2011，[https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)）和 CompCert（Leroy, CACM 2009，[https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)）：对抗性数据集可以证明验证器的有效性，而通过测试并不能证明。每个验证规则都包含一个故意错误的示例，位于 `fixtures/bad/` 目录下，验证器必须在读取任何 `fixture_status` 生命周期元数据之前，先拒绝该错误示例。这种避免循环依赖的原则——验证器不应参考它所评估的工件——是其核心特性。

## 这*不是*什么

- **不是实验跟踪器。** 如果您需要损失曲线、仪表盘或长期运行的存储，请使用 [MLflow](https://mlflow.org)、[Weights & Biases](https://wandb.ai) 或 [TensorBoard](https://www.tensorflow.org/tensorboard)。这些工具记录了训练器声称发生的情况。`backprop-trace` 重新推导的是内部计算是否一致。它们是互补的，而不是重叠的。
- **不是学习证明 (Proof-of-Learning) 或 zkML。** PoL 方法（Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)）已被证明可以在实际训练中被伪造（Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/))。zkML/opML（EZKL, Modulus, ORA）生成密码学或经济支持的证明，用于在不可信的链上进行结算。`backprop-trace` 不是密码学的，它是一个单步验证工具，目标是人类或 CI 审查者。
- **不是供应链溯源工具。** [Sigstore 模型签名](https://github.com/sigstore/model-transparency)、[SLSA-for-models](https://slsa.dev) 和 [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) 证明了“工件 X 是由流水线 Y 产生的”。`backprop-trace` 证明了“此更新可以从这些因素中数学推导出来”。它们是互补的——ML-BOM 可以引用 `backprop-trace` 验证报告，将其作为内部一致性的前提条件。

## 威胁模型

backprop-trace 是一个确定性验证器：其范围包括任何应该被拒绝但实际上被接受的记录，例如：规约绕过、NaN/Infinity 注入、规范发射偏差、反循环违规（验证器在完成规则检查之前会咨询 `fixture_status`）、以及引擎重新计算与导入的框架跟踪之间的不一致。超出范围的内容包括：训练过程本身的可靠性、正在训练的模型是否正确、针对验证器进程的侧信道或时间攻击，以及任何超出记录接受决策的内容。确定性是有限制的：只有在相同的 backprop-trace 版本、相同的 Node.js 主要版本（目前为 22.x）以及相同的规范发射版本下，才能保证字节级别的输出一致。跨引擎（Hermes、JSC、Bun-JSC）和跨 Node.js 主要版本（24.x、26.x 等）的重现不属于目标范围。验证器信任记录的格式和规范发射协议，但不信任生成者。请参阅 [SECURITY.md](./SECURITY.md)，了解漏洞披露时间线、严重程度评估标准以及完整的详细信息。

## 安装

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

已锁定为 Node 22.x (V8 fdlibm `Math.exp` 的确定性至关重要——请参阅 [`docs/computation-order.md`](./docs/computation-order.md))。

## 命令行用法

v0.7 包含 16 个子命令。完整参考：[`docs/cli.md`](./docs/cli.md)。

```
bp reconcile receipt <file>          Reconcile a receipt against the 16 rules.
bp verify mazur [<file>]             Full gate (Mazur 2-2-2): schema + reconcile + engine-reproduce + byte-equal + drift.
bp verify general <file>             Generalized verify for any v0.2+ receipt (XOR, iris, softmax+CE, custom).
bp verify multi <file.jsonl>         Multi-record JSONL; per-record Rules 1-8 + cross-record Rules 9 + 10.
bp generate mazur [--out F]          Re-run the Mazur engine, emit canonical bytes.
bp generate xor [--out F]            Re-run the XOR engine, emit canonical bytes.
bp generate iris [--out F]           Re-run the iris engine, emit canonical bytes.
bp generate from-config <file>       Read a topology+input JSON, emit a canonical receipt.
bp scaffold topology --topology T    Write a sample input file (T = mazur|xor|iris).
bp validate-input <file>             Schema-validate an input config without running the engine.
bp validate <file>                   Schema-only validation of a receipt (auto-detects v0.1/0.2/0.3/0.4).
bp import pytorch <sidecar.jsonl>    Ingest a PyTorch framework trace; emit observer-mode receipt + Rule 14 diff.
bp import jax <sidecar.jsonl>        Ingest a JAX framework trace; same shape as PyTorch.
bp import tensorflow <sidecar.jsonl> Ingest a TensorFlow framework trace; same shape as PyTorch / JAX.
```

常用参数（请参阅 [`docs/cli.md`](./docs/cli.md)）：

- `--out <file>` — 将输出写入文件，而不是标准输出
- `--json` — 机器可读的 JSON 输出（用于 CI 系统）
- `--verbose`, `-V` — 在运行前显示详细的错误信息
- `--color=auto|never|always` — 设置输出颜色；尊重 `NO_COLOR` 环境变量
- 文件参数 `-` 从标准输入读取数据（用于 `reconcile receipt`、`validate` 和 `verify general` 命令）

退出码：`0` 表示成功；`1` 表示验证失败；`2` 表示用法错误或 I/O 错误；`3` 表示无效的命令行参数；`4` 表示框架未实现。

## 库的使用

```ts
import {
  reconcileReceipt,
  runMazurStep,
  MAZUR_INPUT,
  validateReceiptSchema,
  hashReceipt,
  verifyEngineReproduces,
  importPytorchSidecar,
  importJaxSidecar,
  importTensorflowSidecar,
} from '@mcptoolshop/backprop-trace';

// Engine-authored receipt (built-in Mazur / XOR / iris path)
const receipt = runMazurStep(MAZUR_INPUT);

const validated = validateReceiptSchema(receipt);
if (!validated.ok) { console.error(validated.errors); process.exit(1); }

const result = reconcileReceipt(receipt);
if (!result.ok) { console.error(result.failures); process.exit(1); }

const sha = hashReceipt(receipt);                  // in-toto v1 attestation seam
const repro = verifyEngineReproduces(receipt);     // confirm engine reproduces bit-equal

// External framework trace (observer-mode receipt path — v0.6+)
const { emittedBytes, receipt: imported, differentialPassed } =
  importPytorchSidecar(sidecarBytes, { importTimestamp: '2026-05-17T00:00:00Z' });
if (!differentialPassed) { /* engine recomputation disagreed; see receipt.attestor */ }
```

子路径导入：`./reconcile`、`./engine`、`./general-engine`、`./mazur`、`./topology`、`./activations`、`./emit`、`./format`、`./runtime-format`、`./validate`、`./parse`、`./parse-input`、`./hash`、`./schema-loader`、`./verify-engine`、`./extract`、`./import-pytorch`、`./import-jax`、`./import-tensorflow`、`./import-observer`、`./schema`、`./schema/0.1.0`、`./schema/0.2.0`、`./schema/0.3.0`、`./schema/receipt-0.4.0`、`./schema/0.4.0` (topology-input)、`./schema/framework-trace-0.1.0`。

## 导入您自己的训练跟踪

v0.6 的外部导入功能允许 PyTorch / JAX / TensorFlow 用户验证他们自己的单步反向传播跟踪，并使用相同的 16 条规则——**但目前该辅助程序是手动编写的**。 尚不存在 `pip install backprop-trace-pytorch` 这样的辅助工具。 要生成一个辅助程序：

1. 阅读 [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) 模式——它定义了用于一个训练步骤的 JSONL 协议（拓扑 + 输入 + 前向传播 + 梯度 + 参数_在 + 参数_后 + 溯源信息）。
2. 从您的训练步骤中提取这些值（PyTorch `autograd`、JAX `grad`/`value_and_grad`、TF `tf.GradientTape`——所有这些都公开了每个张量的必要数值信息）。
3. 以规范 JSONL 格式输出辅助程序（使用十进制字符串，而不是二进制浮点数——请参阅 [`docs/canonical-emission.md`](./docs/canonical-emission.md))。
4. 运行 `bp import pytorch <sidecar.jsonl>`（或 `import jax` / `import tensorflow`）。
5. 导入器会生成一个 **观察器模式的记录**：框架的声明以规范字段的形式存在；backprop-trace 引擎重新计算相同的步骤，并运行 **第 14 条规则** 作为差异检查。 如果出现不一致，则表明您的提取器撒谎了，或者您的框架发生了变化，或者跟踪本身存在问题。

这是一种实际的工作流程，但效率较低。 请参阅 [此版本中未包含的内容 (暂定)](#whats-not-in-this-version-yet)，以了解有关实时辅助程序打包的更多信息。

每个框架的子命令都受到约束：`bp import pytorch` 会拒绝 JAX 的相关组件，反之亦然。没有自动检测（此软件包中没有框架运行时依赖项，这是设计上的选择）。

## 16 条规则

| # | 规则 |
|---|---|
| 0 | 结构性错误哨兵（schema 级别） |
| 0.8 | 概率边界——softmax 输出在 [0, 1] 范围内 |
| 1 | 输出误差信号一致性 |
| 2 | 下游贡献和反向传播求和 |
| 3 | 隐藏误差信号一致性 |
| 4 | 更新梯度一致性 |
| 5 | 更新值一致性 |
| 6 | 权重演进 |
| 7 | 最终状态一致性 |
| 8 | 溯源引用一致性 |
| 9 | 多步参数链（`parameters_before[N]` = 之前的 `parameters_after[N-1]`） |
| 10 | 多步跟踪标识（共享 `trace_id` + 序列 `step_index`） |
| 11 | softmax 归一化（`sum(forward[output].out) == 1.0`） |
| 12 | 损失公式一致性（半平方误差 + cross-entropy-softmax 分支） |
| 13 | 双重形式一致性（softmax+CE 雅可比分解；GATED — 仅在 `dual_form` 存在时触发） |
| 14 | 引擎重新计算微分（对于观察者模式导入的接收器，是强制性的） |
| 15 | 需要跳过基础（封闭枚举 `EXTERNAL_TRUST_BASIS`，包含 4 个值） |
| 16 | 证明摘要绑定（GATED — 当 `attestor.signed_subject_digest` 存在时触发） |

完整的说明请参考 [`docs/reconciliation.md`](./docs/reconciliation.md)。 每条规则都包含一个对应的错误示例，位于 `fixtures/bad/` 目录下，遵循 Csmith 的原则。

## 确定性范围

以下内容是针对固定矩阵（Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.7.x）的约定：

- `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl` 的字节相等
- 捆绑框架相关组件的外部黄金数据：`pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- Mazur 2-2-2 基准：`post_update_loss.total = 0.29102777369359933`（与广泛引用的下游值 0.291027924 相比，漂移约为 1.5e-7；请参阅 `fixtures/mazur.published.json` 以获取详细信息）
- 在混合容差范围内进行每条规则的对齐（`atol = 1e-12`, `rtol = 1e-9` 用于引擎生成的；对于数学精确的情况，容差更严格）

以下内容不属于约定：

- 跨引擎（Bun, Deno, 浏览器）——不同的 `Math.exp` 实现
- 跨 Node 主版本（24.x, 26.x, …）——V8 fdlibm 端口可能会被修改
- 任意 V8 次版本更新——ECMA-262 §21.3 将 `Math.exp` 的精度定义为实现相关的
- `Math.exp`（sigmoid, tanh, softmax）在不同 V8 版本中的值稳定性

一个 `Math.exp(-0.5)` 的 canary 在每个 CI 单元中运行，作为 V8 fdlibm 漂移的早期预警信号。如果出现故障，表示“调查 V8 的变更日志”，而不是“引擎错误”。

## 以下内容不在此版本中（但将来可能会包含）：

`backprop-trace v0.7.0` 是一个 **中期 v0 产品**。核心引擎、对齐器、规范化发射合约以及外部导入路径都是真实且稳定的。但是，一些 v1.0 验证器所需的功能尚未包含在内：

- **多步骤的观察模式收据。** 目前的外部数据导入是单步骤的。 真正的训练过程需要成千上万个步骤。 *目标：v0.8 版本。*
- **超越标准 SGD 的优化器。** 不支持 Adam、AdamW、动量或权重衰减。 2026 年的实际机器学习训练主要使用 Adam；仅使用 SGD 是一种真正的限制。 *路线图目标：v0.9 版本。*
- **批处理维度。** 目前为单样本。 真正的 PyTorch/JAX/TF 训练是批处理的。 用户在实际训练步骤中无法直接导入，需要手动展开每个样本。 *路线图目标：v0.9 版本。*
- **实时框架辅助工具。** 目前的辅助工具是手动编写的；没有 `pip install backprop-trace-pytorch` 包，也没有 `scripts/python-helpers/dump_pytorch_trace.py` 这样的可以直接运行的提取工具。 从“我有一个 PyTorch 步骤”到“我有一个收据”的路径太长。 *路线图目标：v0.10 版本。*
- **实际应用场景。** 核心是 Mazur 2-2-2 教学示例。 v1.0 版本的验证器应该至少包含一种可识别的架构（例如，小型 CNN 的前向和反向传播，小型 Transformer 块），作为内置的测试用例。 *路线图目标：v0.11 版本。*
- **用户验证。** 目前没有外部研究案例，也没有课程采用该工具进行教学，也没有合规工程师将其用于审计。 *路线图目标：在任何 v1.0 版本发布之前。*
- **GPU 确定性。** 不在范围之内（并且很可能仍然如此——cuDNN ConvolutionBackwardFilter 中的原子操作会破坏跨运行的精确性，[CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/))。 产品的定位是：确定性的 CPU 解决方案。

如果您的工作流程依赖于上述任何一项，那么这个版本可能不适合您。

## 自定义拓扑结构的设计

通过 JSON 配置文件驱动引擎，无需进行 TypeScript 代码修改：

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

请参阅 [`docs/authoring.md`](./docs/authoring.md) 了解详细步骤，包括输入与收据的模式，以及可信的输出边界。

## 适用场景

- **注重可重复性的论文作者**（NeurIPS/ICML/CoLLAs 的投稿者；了解 REFORMS 的研究人员——Kapoor 等人，《Science Advances》，2024 年，[https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)）——评审员可以在 30 秒内重现每个步骤的证据。
- **机器学习教学**（Karpathy 的从零到英雄教程，大学的深度学习课程，机器学习系统面试准备）——每个训练步骤都清晰可见，并且有一个验证器，可以*拒绝*故意损坏的测试用例。
- **机器学习框架/编译器工程师**（PyTorch / JAX / MLIR / XLA 的贡献者）——为差异测试生成每个操作的已知良好轨迹，用于与新的编译器输出进行比较。
- **机器学习合规/审计工程师**（欧盟人工智能法案第 10 条的实施者，[https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML 的用户）——提供一种每步骤的收据格式，用于模型签名，并将其附加到模型卡或审计包中。

## 参考类

- **学习证明溯源** — Jia 等人 (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) 阐述了结构性思想；Fang 等人 (EuroS&P 2023) 指出了一个重要的警示：在实际应用中，学习证明是可以被伪造的。`backprop-trace` 的应用范围缩小到可以实现确定性的场景：单步 CPU 验证。
- **REFORMS** — Kapoor 等人 (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — 包含 32 个机器学习可复现性检查项；每一步的证据可以映射到第 24-30 个检查项。
- **Csmith + CompCert 思想** — Yang 等人 (PLDI 2011) 和 Leroy (CACM 2009) — 对抗性数据集可以证明验证器的有效性；评估器不应该访问它所评估的原始数据。
- **供应链认证** — in-toto v1, SLSA Provenance v1.0, Sigstore model-transparency ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — `backprop-trace` 生成的凭证可以作为 DSSE 声明的主题。

这**不是** zkML（不涉及密码学简洁性）。这**不是** opML（不涉及欺诈证明机制）。这**不是** 机器学习指标记录器 — `backprop-trace` 记录的是十进制字符串，而不是二进制浮点数；其设计理念更接近于 Jest 快照或 Rust 的 `insta`。

## 法律栈

摘自 `docs/canonical-emission.md`：

> 协议先于引擎。格式化策略先于运行时格式化。不良凭证先于良好凭证。运行时格式化先于 Mazur。Mazur 先于诊断。

## 链接

- [`docs/quickstart.md`](./docs/quickstart.md) — 五分钟快速入门
- [`docs/cli.md`](./docs/cli.md) — `bp` 子命令参考
- [`docs/authoring.md`](./docs/authoring.md) — 创建自定义拓扑
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 16 条对齐规则
- [`docs/topology.md`](./docs/topology.md) — 通用拓扑创建
- [`docs/multi-step.md`](./docs/multi-step.md) — 多步训练凭证（由引擎生成）
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — 字节级编码协议
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 排序；禁止使用 FMA；混合容差；确定性边界
- [`docs/schema.md`](./docs/schema.md) — 字段级别的模式详解
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 认证机制
- `fixtures/` — 规范的黄金标准（Mazur、XOR、每个神经元的偏置 XOR、iris、softmax-CE、多步 XOR），外部侧车程序 + 观察者模式黄金标准（PyTorch、JAX、TensorFlow），故意制造的错误凭证（每条对齐规则对应一个错误凭证）
- `schemas/` — 凭证 v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0，拓扑输入 v0.4.0，框架跟踪 v0.1.0（所有版本均已关闭，带有 `x-order` 注释，为增量版本）
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 法律栈，反循环机制，不良凭证先于良好凭证的原则
- [`SECURITY.md`](./SECURITY.md) — 哪些情况被认为是验证器的漏洞
- [`CHANGELOG.md`](./CHANGELOG.md) — 每个版本的历史记录

## 许可证

MIT — 参见 `LICENSE`。
