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

这是一种用于神经网络训练步骤的、具有 26 条规则的确定性验证器。 您需要提供一个包含所有对梯度更新做出贡献的因素的记录；验证器会重新推导每个声明，如果发现不一致，则会拒绝。 这遵循了 *"预言机不应检查它所判断的对象"* 的原则。

> **状态：mid-v0 (v0.11.0) — 首次可发布版本。** 仅支持 CPU。 验证器覆盖了 SGD + Adam + AdamW + PyTorch 风格的 SGD 动量（经典 + Nesterov + 阻尼）。
> 实时 PyTorch 辅助工具 (`scripts/extract/pytorch.py`) 覆盖了相同的优化器矩阵。 仅作为观察者使用 — [第 14 条规则](./docs/reconciliation.md) 具有权威性。
> v0.11 是第一个通过 npm 发布的版本；v1.0 仍然需要 [实际场景测试 + 用户验证 + 多框架实时辅助工具](#whats-not-in-this-version-yet) 的支持。 在生产环境中使用之前，请参阅 [`docs/live-helpers.md`](./docs/live-helpers.md)。

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

Mazur 2-2-2 是关于反向传播的、在开放网络上引用最多的单步教程 ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/))。 其中的每一个数字都可以手动推导。

## 这是什么

这是一种用于单个训练步骤的数值正确性验证器。 验证器会根据 26 条规则，从已命名的因素重新推导每个声明。 如果任何规则在混合容差 (`atol + rtol`) 范围内出现不一致，则会拒绝该记录。 多步（第 9 + 第 10 条规则）、批量处理（第 18 + 第 19 条规则）、Adam 动量递归（第 22-24 条规则）、SGD 动量递归（第 20 + 第 21a/21b/21c + 第 25 + 第 26 条规则），以及在导入的框架跟踪中进行引擎重新计算的微分（第 14 条规则）涵盖了与生产相关的方面。

它**不**验证整个训练过程，也不证明模型是否正确，更不能替代实验跟踪器。 它证明了每个记录的步骤在数学上是自洽的，并且链条是完整的。 对抗性数据集可以证明验证器的有效性 ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — 每条规则都配有一个错误的测试用例，位于 [`fixtures/bad/`](./fixtures/bad) 目录下，验证器必须在读取任何 `fixture_status` 元数据之前拒绝这些测试用例。

## 实时 PyTorch 辅助工具 (v0.10+)

单个可审计的 Python 文件。 默认情况下不包含 pip 包 — 将其复制到您的仓库中，阅读它，运行它。

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

该辅助工具会生成一个 `framework-trace.v0.7.0` 的附加文件，其中包含一个名为 `helper` 的信息块（名称、版本、源哈希、框架版本、运行时、提取时间戳）。 该信息块**不是凭证** — 第 14 条规则（引擎重新计算微分）是关于每个辅助工具生成的附加文件的权威。 即使辅助工具声称如此，伪造/错误/缺失的 `source_hash` 也不会绕过第 14 条规则。 请参阅 [`docs/live-helpers.md`](./docs/live-helpers.md)，了解信任边界声明、禁止列表、9 个对抗性测试用例目录以及不进行 pip 分发的承诺。

**支持 (v0.10.x)**：PyTorch SGD + Adam + AdamW + sgd_momentum（经典/Nesterov/阻尼，以及根据 [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099) 的 `momentum_buffer` 升值→降值符号翻转）。 优先支持 CPU。 支持单步和多步。
**超出范围**：AMP/autocast、CUDA/MPS/XLA、SGD 耦合 L2 权重衰减、AMSGrad/NAdam/RAdam/Lion/LBFGS、多隐藏层拓扑。 手动编写的针对这些框架/优化器的附加文件仍然可以通过标准的 `bp import` 路径正常工作。

## 这不包括什么

- **并非实验跟踪器。** 使用 [MLflow](https://mlflow.org)，[Weights & Biases](https://wandb.ai)，[TensorBoard](https://www.tensorflow.org/tensorboard) 等工具来记录实验结果；`backprop-trace` 用于重新验证数学计算的内部一致性。
- **并非学习证明或零知识机器学习 (zkML)。** [PoL](https://arxiv.org/abs/2103.05633) 已被证明可以在实际训练中被伪造 ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567))；zkML 产生密码学证明。`backprop-trace` 是一种非密码学的方法，仅进行单步验证，并且主要面向人工审查或 CI 审查。
- **并非供应链溯源。** [Sigstore 模型签名](https://github.com/sigstore/model-transparency)，[SLSA-for-models](https://slsa.dev)，[CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) 用于验证流水线的来源；`backprop-trace` 用于验证数值的一致性。一个 ML-BOM 可以引用 `backprop-trace` 的结果作为内部一致性的一个条件。

## 威胁模型

适用范围：任何应该被拒绝但实际上被接受的记录，包括：模式绕过、NaN/Infinity 值的注入、规范输出的偏差、循环依赖的违反、以及引擎重新计算与导入的辅助模块之间的不一致。 不适用范围：训练过程本身的可靠性，以及对验证器过程的侧信道攻击。 确定性是有限制的：只有在相同的 `backprop-trace` 版本、Node.js 22.x 版本以及相同的规范输出的情况下，才能保证完全相同的输出。 详细信息请参阅 [SECURITY.md](./SECURITY.md)，其中包含完整的列表和披露时间线。

## 安装

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

已锁定为 Node 22.x (V8 fdlibm `Math.exp` 的确定性至关重要——请参阅 [`docs/computation-order.md`](./docs/computation-order.md))。

## 命令行工具 (CLI)

完整参考：[`docs/cli.md`](./docs/cli.md)。

| 命令 | 用途 |
|---|---|
| `bp reconcile receipt <file>` | 运行所有 26 条规则；如果第一次失败，则退出代码为 1。 |
| `bp verify mazur` | 对捆绑的 Mazur 测试用例进行全面验证。 |
| `bp verify general <file>` | 通用验证（v0.2+ 版本的记录：XOR，iris，softmax+CE，观察器模式）。 |
| `bp verify multi <file.jsonl>` | 处理多条 JSONL 记录，并对记录之间的第 9/10 条规则进行验证。 |
| `bp generate {mazur,xor,iris}` | 重新运行指定的引擎，并输出规范的字节。 |
| `bp generate from-config <file>` | 从包含拓扑和输入的 JSON 文件中重新运行引擎。 |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | 写入一个初始的配置。 |
| `bp validate-input <file>` | 验证拓扑和输入的配置是否符合模式。 |
| `bp validate <file>` | 验证记录是否符合模式（自动检测 v0.1-v0.7 版本）。 |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | 导入外部框架的跟踪信息。 |
| `bp examples pytorch [--print]` | 打印或显示捆绑的 PyTorch 辅助模块的路径。 |

常用参数：`--out <file>`，`--json`，`--verbose`/`-V`，`--color=auto|never|always`。 文件参数 `-` 表示从标准输入读取。 退出代码：`0` 表示成功；`1` 表示验证失败；`2` 表示用法错误或 I/O 错误；`3` 表示无效的命令行参数；`4` 表示框架未实现。

## 库

```ts
import {
  reconcileReceipt, runMazurStep, MAZUR_INPUT,
  validateReceiptSchema, hashReceipt, verifyEngineReproduces,
  importPytorchSidecar, importJaxSidecar, importTensorflowSidecar,
} from '@mcptoolshop/backprop-trace';

const receipt = runMazurStep(MAZUR_INPUT);
const validated = validateReceiptSchema(receipt);    // schema gate
const result = reconcileReceipt(receipt);             // 26-rule gate
const sha = hashReceipt(receipt);                     // in-toto seam
const repro = verifyEngineReproduces(receipt);        // bit-equal recompute

const { receipt: imported, differentialPassed } =
  importPytorchSidecar(sidecarBytes);                 // observer-mode + Rule 14
```

子路径导入：`./reconcile`，`./engine`，`./general-engine`，`./mazur`，`./topology`，`./activations`，`./emit`，`./validate`，`./parse`，`./parse-input`，`./hash`，`./schema-loader`，`./verify-engine`，`./extract`，`./import-pytorch`，`./import-jax`，`./import-tensorflow`，`./import-observer`，以及模式相关的目录 `./schema/...`。

## 16 条规则

完整说明 + 对抗性测试用例：[`docs/reconciliation.md`](./docs/reconciliation.md)。

| # | 规则 |
|---|---|
| 0 | 结构性错误哨兵（schema 级别） |
| 0.8 | 概率边界——softmax 输出在 [0, 1] 范围内 |
| 1-4 | 错误信号（输出、下游、隐藏）+ 梯度一致性更新。 |
| 5-7 | 更新值、权重和最终状态（AdamW 分支，用于规则 6/7 中的权重衰减）。 |
| 8 | 溯源引用一致性 |
| 9-10 | 多步参数链 + 跟踪标识。 |
| 11-13 | Softmax 归一化 + 损失函数 + 双重形式（GATED）。 |
| 14 | 引擎重新计算的差异（在观察器模式下导入时是强制性的）。 |
| 15-17 | 跳过基础 + 签名摘要绑定 + 捆绑根目录绑定（GATED）。 |
| 18-19 | 批量归纳的一致性 + 样本集的一致性（GATED）。 |
| 20 | 优化器状态的形状（Adam：`{m, v}` / sgd_momentum：`{buffer}`）。 |
| 21 | **PyTorch 风格的 SGD 动量：** 21a 缓冲递归 + 21b 有效方向 + 21c 参数更新。 |
| 22-24 | Adam 算法的瞬时值更新 + 偏差校正 + 参数更新 (epsilon 在 sqrt 之外) |
| 25-26 | 多步优化器状态链 + 优化器配置的稳定性 |

## 确定性范围

针对 Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x 的合约：字节级别的黄金标准 (Mazur, XOR, iris, softmax+CE, 多步, 批量处理, 外部辅助模块)；Mazur 锚点 `post_update_loss.total = 0.29102777369359933`；在 `atol=1e-12` 和 `rtol=1e-9` 的范围内，对引擎生成的规则进行一致性校验。

非合约内容：跨引擎 (Bun, Deno, 浏览器)；跨 Node 主版本 (24.x+); 任意的 V8 次版本更新。一个 `Math.exp(-0.5)` 的 canary (预警机制) 在每个 CI 单元中触发，作为 V8 fdlibm 漂移的警报。

## 以下内容不在此版本中（但将来可能会包含）：

backprop-trace v0.11.0 是第一个通过 npm 发布的版本，但**仍然处于 v0 阶段**。引擎、重构器、规范化输出合约、外部数据导入路径以及 PyTorch 实时辅助工具都是真实且稳定的。要达到 v1.0，需要解决以下问题：

- **异构多框架跟踪** — 仅支持单框架捆绑包；不支持混合框架流。*可能超出范围。*
- **多步跟踪中的生产者身份绑定** — 规则 17 检测捆绑包完整性问题，而不是生产者身份验证。与规则 16 / Sigstore / 外部证明相结合。这是一个操作层面的功能，不是内置的。
- **SGD 结合 L2 权重衰减** — 规则 7 的第三个分支；*v0.11。*
- **AMSGrad / NAdam / RAdam / Lion / 针对每个参数的组 / 学习率调度 / 梯度裁剪 / 混合精度** — *v0.10+。*
- **批量接收中的每个样本梯度** — 目前仅支持降阶梯度；每个样本的分解对于影响审计很有用。*v0.10.x / v0.11。*
- **跨步的异构批次大小** — 每个流的批次大小是固定的。*可能超出范围。*
- **JAX / TensorFlow 实时辅助工具** — 手动编写的辅助模块可以工作；实时辅助工具是 *v0.11 (JAX，由 adopter-pull 触发) / v0.12+ (TF)*。
- **真实世界的测试用例** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur 是关键；小型 CNN / transformer 块测试用例是 *v0.11*。
- **用户验证** — 没有外部研究案例，没有课程采用，没有在实际应用中的合规性捆绑包。*在 v1.0 之前需要完成。*
- **GPU 确定性** — 超出范围，并且很可能永远无法实现 (cuDNN ConvolutionBackwardFilter 的原子操作会破坏位精确性，参见 [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/))。产品的定位是具有确定性的 CPU 环境。

如果您的工作流程依赖于上述任何一项，那么这个版本可能不适合您。

## 编写自定义拓扑结构

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

请参阅 [`docs/authoring.md`](./docs/authoring.md) — 输入与接收模式、规范化输出的信任边界。

## 适用场景

- **可重现性优先的论文作者** (NeurIPS/ICML/CoLLAs; 了解 [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) — 每一步的证据都可以重现，评审人员可以在 30 秒内运行。
- **机器学习教学** (Karpathy zero-to-hero, 大学深度学习课程, 面试准备) — 一个带有所有因素可见的命名训练步骤，以及一个会 *拒绝* 故意破坏的测试用例的重构器。
- **机器学习框架 / 编译器工程师** (PyTorch / JAX / MLIR / XLA 贡献者) — 用于差分测试的已知良好的每个操作跟踪。
- **机器学习合规性 / 审计工程师** ([欧盟人工智能法案第 10 条](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — 每一步的接收数据位于模型签名下方，附加到模型卡或审计捆绑包中。

## 法律栈

摘自 `docs/canonical-emission.md`：

> 协议先于引擎。格式化策略先于运行时格式化。不良凭证先于良好凭证。运行时格式化先于 Mazur。Mazur 先于诊断。

## 链接

- [`docs/quickstart.md`](./docs/quickstart.md) — 五分钟快速入门指南
- [`docs/cli.md`](./docs/cli.md) — `bp` 子命令参考
- [`docs/live-helpers.md`](./docs/live-helpers.md) — v0.10 实时 PyTorch 辅助工具：工作流程、信任边界、对抗性目录、不使用 pip 的原因
- [`docs/authoring.md`](./docs/authoring.md) — 创建自定义拓扑结构
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 完整的 26 条重构规则
- [`docs/topology.md`](./docs/topology.md) — 通用拓扑结构创建
- [`docs/multi-step.md`](./docs/multi-step.md) — 多步骤训练流程
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — 字节级编码协议
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 排序；禁止使用 FMA；确定性边界
- [`docs/schema.md`](./docs/schema.md) — 字段级别的模式详解
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 认证机制
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 防止循环依赖；“坏的记录先于好的记录”原则
- [`SECURITY.md`](./SECURITY.md) — 验证器认为哪些属于漏洞
- [`CHANGELOG.md`](./CHANGELOG.md) — 版本历史记录

## 许可证

MIT 许可证 — 参见 [LICENSE](./LICENSE)。

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
