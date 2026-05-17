<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

# @mcptoolshop/backprop-trace

一个确定性的训练追踪引擎，它会生成符合标准的 JSONL 格式的单步反向传播过程记录，并通过一个包含 8 条规则的验证器进行验证（所有 8 条规则在 v0.2 版本中已实现）。

## 为什么使用 backprop-trace？

如果您从事神经网络训练的教学、审计或验证工作，您需要一种方法来确认“这个追踪过程是可信的”。 backprop-trace 会生成符合标准的、逐字节的反向传播过程记录，并提供一个验证器，该验证器会从指定的因素中重新推导每个值。 v0.1 版本包含 Mazur 2-2-2 示例，这是在公开网络上引用最多的教学反向传播示例，用作字节级别的回归基准，此外还有一个“坏”示例，用于证明验证器能够正确地拒绝应该被拒绝的内容。

这**不是**一个机器学习指标记录器（请使用 MLflow / W&B / TensorBoard）。 这是一个结构化追踪验证器，属于“证明学习”（Proof-of-Learning）的范畴（Jia 等人，IEEE S&P 2021），其范围限定在教学用的单步示例，而不是完整的训练过程。

## 30 秒快速入门

```bash
pnpm add @mcptoolshop/backprop-trace

npx bp verify mazur
# exit 0 — schema + reconcile + engine-reproduce + byte-equal + drift all pass

npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5; Rule 5 cascade (v0.2+)
# (this is correct — that fixture is deliberately broken; the verifier
#  must catch it BEFORE consulting fixture_status lifecycle metadata)

npx bp generate mazur | sha256sum
# canonical-byte sha256 of the engine output; the in-toto v1 attestation seam
```

要了解更详细的用法，请参阅 [`docs/quickstart.md`](./docs/quickstart.md)；要查看 CLI 参考，请参阅 [`docs/cli.md`](./docs/cli.md)；要了解 attestation 路径，请参阅 [`docs/attestation.md`](./docs/attestation.md)。

## 安装

```
pnpm add @mcptoolshop/backprop-trace
```

或者使用 npm：

```
npm install @mcptoolshop/backprop-trace
```

## CLI 使用

v0.2 版本包含四个子命令。 完整参考：[`docs/cli.md`](./docs/cli.md)。

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

常用参数（请参阅 [`docs/cli.md`](./docs/cli.md) 获取完整参考）：

- `--json` — 机器可读的 JSON 输出（用于 CI 系统）。
- `--verbose`, `-V` — 在运行前显示诊断信息到标准错误输出。
- `--color=auto|never|always` — 设置输出颜色；尊重 `NO_COLOR` 环境变量。
- 文件参数 `-` 从标准输入读取数据（用于“验证接收数据”、“验证”和“验证 Mazur”）。

退出码：0 表示成功，1 表示验证失败，2 表示 I/O 错误或输入数据格式错误，3 表示 CLI 参数无效。

`bp --version` 和 `bp --help` 命令可以在没有子命令的情况下使用；`bp <子命令> --help` 会显示与子命令相关的用法。

## 库的使用

```ts
import {
  reconcileReceipt,
  runMazurStep,
  MAZUR_INPUT,
  validateReceiptSchema,
  hashReceipt,
  verifyEngineReproduces,
} from '@mcptoolshop/backprop-trace';

const receipt = runMazurStep(MAZUR_INPUT);

// Validate against the bundled JSON Schema (v0.2+).
const validated = validateReceiptSchema(receipt);
if (!validated.ok) { console.error(validated.errors); process.exit(1); }

// Reconcile the math against all 8 rules.
const result = reconcileReceipt(receipt);
if (!result.ok) { console.error(result.failures); process.exit(1); }

// Hash the canonical bytes — in-toto v1 attestation seam (v0.2+).
const sha = hashReceipt(receipt);

// Confirm the engine reproduces a receipt byte-for-byte (v0.2+).
const v = verifyEngineReproduces(receipt);
if (!v.matches) { console.error('diverges at byte', v.firstDifferingByte); }
```

请参阅 [`docs/attestation.md`](./docs/attestation.md) 了解 in-toto v1 的映射关系。

子路径导入会被导出（`./reconcile`、`./engine`、`./mazur`、`./emit`、`./format`、`./runtime-format`、`./validate`、`./parse`、`./hash`、`./schema-loader`、`./verify-engine`、`./extract`、`./schema`）。

## 这是什么

一个具有标准逐字节编码的*结构化追踪验证器*。 接收数据是协议；验证器会检查接收数据中声明的每个内容，并验证数学计算是否正确。

参考资料：

- Proof-of-Learning (Jia 等人，IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor 等人，Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang 等人，PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) 用于“坏的接收数据先于好的接收数据”的原则。

不是 zkML（不使用密码学简洁性）。 不是 opML（不使用欺诈证明游戏）。 也不是一个机器学习指标记录器——backprop-trace 写入的是十进制字符串，而不是二进制浮点数；其精神更接近于 Jest 快照 / Rust insta。

## 确定性范围

在 V8/Node 22 的 ULP 范围内，具有 9 位有效数字的追踪精度。 引擎值的默认假设是在 V8 上使用标准的 IEEE 754 双精度浮点数。

跨引擎的兼容性（Hermes、JSC、Bun-JSC）**未经过测试**。 广泛引用的下游锚点值 `0.291027924` 与引擎值 `0.29102777369359933` 存在约 1.5e-7 的差异；请参阅 `fixtures/mazur.published.json` 以获取偏差记录。

v0.1 版本固定在 Node 22.x 版本。

## 这八条规则

1. 输出误差信号的一致性
2. 下游贡献和反向传播求和
3. 隐藏层误差信号的一致性
4. 梯度更新的一致性
5. 更新值的一致性
6. 权重演进
7. 最终状态的一致性
8. 溯源参考的一致性

所有8条规则都已在v0.2版本中实现（第4条规则最初在v0.1版本中发布）。完整的规则说明请参考[`docs/reconciliation.md`](./docs/reconciliation.md)；每条规则都包含一个故意制造错误的`fixtures/bad/mazur.bad-<kind>.jsonl`测试用例，遵循Csmith的原则。

## 法律框架

摘自`docs/canonical-emission.md`:

> 协议先于引擎。格式化策略先于运行时格式化。无效的收据先于有效的收据。运行时格式化先于Mazur。Mazur先于诊断。

## v0.2版本范围

- 仅支持Mazur 2-2-2拓扑结构
- 仅支持单步训练
- 仅支持Sigmoid激活函数 + 均方误差 (MSE) 损失函数
- 每个层的偏置
- SGD优化器（无动量，无Adam，无权重衰减）
- 仅支持CPU（不提供GPU确定性声明）
- 仅支持V8 / Node 22.x版本

多步训练、通用拓扑结构、替代激活函数/损失函数以及更丰富的优化器将在v0.3+版本中实现（请参考[`CHANGELOG.md`](./CHANGELOG.md)以了解v0.2版本中包含的内容）。

## 链接

- [`docs/quickstart.md`](./docs/quickstart.md) — 五分钟快速入门指南
- [`docs/cli.md`](./docs/cli.md) — `bp`子命令参考（v0.2+）
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 八条一致性规则
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — 字节级编码协议
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754排序规则；禁止使用FMA
- [`docs/schema.md`](./docs/schema.md) — 收据模式的字段级详细说明
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 认证机制（v0.2+）
- `fixtures/` — 规范的黄金标准、手工生成的已发布账本、格式化策略，以及八个故意制造错误的`bad-*`收据（每条一致性规则一个）
- `schemas/receipt.v0.1.0.json` — 收据JSON模式（已关闭，包含`x-order`注释，用于驱动规范的输出）
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 法律框架、反循环机制、无效收据先于有效收据的原则
- [`SECURITY.md`](./SECURITY.md) — 验证器认为哪些属于漏洞

## 许可证

MIT — 参见`LICENSE`文件。
