<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

# ```text
@mcptoolshop/backprop-trace

決定論的なトレーニング追跡エンジン。単一のバックプロパゲーションステップごとの標準的なJSONL形式のログを生成し、8つのルールに基づく検証器によって検証されます（v0.2ではすべての8つのルールが実装済み）。

## なぜbackprop-traceを使うのか？

ニューラルネットワークのトレーニングを教育、監査、または検証する場合、"この追跡データは整合性が取れている"ことを示す必要があります。backprop-traceは、単一のバックプロパゲーションステップごとの標準的なバイト単位のログと、名前付きの要素からすべての値を再計算する検証器を提供します。v0.1では、最も引用されている教育用バックプロパゲーションの例である「Mazur 2-2-2」のテストケースを、バイト単位で完全に一致する基準として提供しています。また、検証器が正しく拒否すべきものを拒否することを確認するための、検証に失敗するテストケースも含まれています。

これは、機械学習のメトリクスロガーではありません（それにはMLflow / W&B / TensorBoardを使用してください）。これは、Proof-of-Learningの系譜にある構造的な追跡検証ツールであり（Jia et al. IEEE S&P 2021）、単一ステップの教育用例に特化しています。これは、フルトレーニング実行の規模ではなく、ユニットテストの規模での検証を行います。

## 30秒で始める

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

より詳細な手順については、[`docs/quickstart.md`](./docs/quickstart.md)を参照してください。CLIのリファレンスについては、[`docs/cli.md`](./docs/cli.md)を参照してください。検証パスについては、[`docs/attestation.md`](./docs/attestation.md)を参照してください。

## インストール

```
pnpm add @mcptoolshop/backprop-trace
```

または、npmを使用する場合：

```
npm install @mcptoolshop/backprop-trace
```

## CLIの使用方法

v0.2では、4つのサブコマンドが提供されています。詳細については、[`docs/cli.md`](./docs/cli.md)を参照してください。

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

一般的なオプション（詳細については[`docs/cli.md`](./docs/cli.md)を参照）：

- `--json`：機械可読なJSON形式の出力（CI環境向け）。
- `--verbose`, `-V`：実行前に診断情報を標準エラー出力に出力。
- `--color=auto|never|always`：出力の色設定。`NO_COLOR`環境変数を尊重します。
- ファイル引数 `-`：標準入力から読み込み（ログの検証、検証、Mazurテストの実行）。

終了コード：0（成功）、1（検証エラー）、2（I/Oエラーまたは不正な入力）、3（無効なCLI引数）。

`bp --version`と`bp --help`は、サブコマンドなしで実行できます。`bp <サブコマンド> --help`で、サブコマンドごとの使用方法を表示します。

## ライブラリの使用方法

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

in-toto v1のマッピングについては、[`docs/attestation.md`](./docs/attestation.md)を参照してください。

サブパスからのインポートは公開されています（`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`）。

## このツールの概要

これは、標準的なバイト単位のエンコーディングを持つ*構造的な追跡検証ツール*です。ログは契約であり、検証器はログに含まれるすべての主張を検証し、計算が一致するかどうかを確認します。

参照資料：

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf)（不正なログが正しいログよりも前に来るという原則について）

zkMLではありません（暗号的な簡潔性はありません）。opMLではありません（不正検出ゲームはありません）。機械学習のメトリクスロガーでもありません。backprop-traceは、二進数の浮動小数点数ではなく、10進数の文字列を書き込みます。JestのスナップショットやRustのinstaに近いものです。

## 決定論の範囲

V8/Node 22のULP範囲内で、9桁の精度を持つ追跡データ。エンジン内の値は、V8上のスカラーIEEE 754の倍精度浮動小数点数であることを前提としています。

他のエンジン（Hermes、JSC、Bun-JSC）での移植性は**テストされていません**。広く引用されている下位レベルの基準値`0.291027924`と、エンジン値`0.29102777369359933`との差は、約1.5e-7です。詳細については、`fixtures/mazur.published.json`を参照してください。

v0.1はNode 22.xに固定されています。

## 8つのルール

1. 出力エラー信号の一貫性
2. 下流からの寄与と逆伝播された合計
3. 隠れエラー信号の一貫性
4. 更新勾配の一貫性
5. 更新値の一貫性
6. 重みの変化
7. 最終状態の一貫性
8. 参照情報の整合性

上記の8つのルールはすべてv0.2で実装されています（ルール4は元々v0.1で実装されました）。各ルールの詳細な説明は、[`docs/reconciliation.md`](./docs/reconciliation.md) に記載されています。各ルールには、Csmithの原則に従い、意図的にエラーを含む `fixtures/bad/mazur.bad-<kind>.jsonl` というテストデータが付属しています。

## 法規のスタック

`docs/canonical-emission.md` に記載されています。

> コントラクトはエンジンよりも優先されます。フォーマッタのポリシーは、実行時のフォーマットよりも優先されます。不正なレシートは、正しいレシートよりも優先されます。実行時のフォーマットは、Mazurよりも優先されます。Mazurは、診断よりも優先されます。

## v0.2 の範囲

- Mazur 2-2-2 トポロジーのみ
- シングルステップの学習のみ
- シグモイド活性化関数 + 二乗誤差 (MSE) 損失のみ
- レイヤーごとのバイアス
- SGDオプティマイザー (モーメンタムなし、Adamなし、重み減衰なし)
- CPUのみ (GPUの決定論的な動作を保証するものではありません)
- V8 / Node 22.x のみ

マルチステップの学習、汎用的なトポロジー、代替の活性化関数/損失関数、およびより高度なオプティマイザーは、v0.3以降で実装される予定です（v0.2で実装された機能については、[`CHANGELOG.md`](./CHANGELOG.md) を参照してください）。

## リンク

- [`docs/quickstart.md`](./docs/quickstart.md) — 5分間の入門
- [`docs/cli.md`](./docs/cli.md) — `bp` サブコマンドのリファレンス (v0.2+)
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 8つの整合ルール
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — バイトレベルのエンコーディングに関する契約
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 の演算順序ルール; FMA の禁止
- [`docs/schema.md`](./docs/schema.md) — レシートスキーマのフィールドごとの解説
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 のアテスト機能 (v0.2+)
- `fixtures/` — 標準的な正解データ、手動で作成された公開レジャー、フォーマッタポリシー、および意図的にエラーを含む `bad-*` レシート (各整合ルールに対応する1つずつ)
- `schemas/receipt.v0.1.0.json` — レシートのJSONスキーマ (非推奨、`x-order` アノテーションにより標準的なエンコーディングを強制)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 法規のスタック、循環防止メカニズム、不正なレシートが正しいレシートよりも優先されるという原則
- [`SECURITY.md`](./SECURITY.md) — 検証者が脆弱性として認識するものの定義

## ライセンス

MIT — `LICENSE` を参照してください。
