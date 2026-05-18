<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

ニューラルネットワークの学習ステップを検証するための、決定論的な26ルールベースの検証ツールです。このツールは、勾配更新に関与するすべての要素を記述した情報を入力として受け取り、入力された情報と検証結果を照合し、不一致がある場合はエラーを返します。これは、Csmith/CompCertの「検証ツールは、検証対象のアーティファクトを参照してはならない」という原則に基づいています。

**ステータス: mid-v0 (v0.11.0) — 初めて公開可能なバージョン。** CPUのみ対応。検証対象は、SGD、Adam、AdamW、およびPyTorchスタイルのSGDモメンタム（古典的、Nesterov、減衰付き）です。
ライブPyTorchヘルパー (`scripts/extract/pytorch.py`) も、同じ最適化アルゴリズムをサポートしています。これは、検証のみを行うものであり、[ルール14](./docs/reconciliation.md) が基準となります。
v0.11は、npmで公開された最初のバージョンです。v1.0では、[実世界のデータセットでの検証、ユーザーによる検証、および複数のフレームワークに対応したライブヘルパー](#whats-not-in-this-version-yet) が必要です。本番環境で使用する前に、[`docs/live-helpers.md`](./docs/live-helpers.md) をご確認ください。

## 30秒で始める

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

Matt Mazur氏による、バックプロパゲーションのステップごとの解説 ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)) は、広く引用されています。この解説に含まれるすべての数値は、手計算で導き出すことができます。

## このツールの概要

単一の学習ステップにおける数値的な正確性を検証するツールです。このツールは、入力された情報から各要素を再計算する26のルールを実行し、その結果を検証します。いずれかのルールで許容範囲 (`atol + rtol`) を超える不一致が見つかった場合、入力された情報は無効と判断されます。複数ステップ (ルール9 + 10)、バッチ処理 (ルール18 + 19)、Adamのモメンタムの再帰 (ルール22-24)、SGDのモメンタムの再帰 (ルール20 + 21a/21b/21c + 25 + 26)、およびインポートされたフレームワークのトレースにおけるエンジンによる微分再計算 (ルール14) は、本番環境で重要な要素をカバーしています。

このツールは、**全体の学習プロセスを検証するものではありません**。また、モデルが正しいことを証明するものでも、実験の追跡ツールを置き換えるものでもありません。各記録されたステップが数学的に一貫性があり、データが破損していないことを証明します。検証ツールに対する攻撃的なデータセットの作成は、検証ツールの有効性を示すために行われています ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf))。検証ツールは、検証対象のデータセットを読み込む前に、意図的に不正なデータセット (`fixtures/bad/`) を拒否する必要があります。

## ライブPyTorchヘルパー (v0.10以降)

単一の監査可能なPythonファイルです。意図的にpipパッケージとして提供されていません。このファイルをリポジトリにコピーし、内容を確認して実行してください。

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

このヘルパーは、`framework-trace.v0.7.0` というサイドカーファイルを作成します。このファイルには、フォレンジック用の `helper` ブロックが含まれており、名前、バージョン、ソースハッシュ、フレームワークのバージョン、実行環境、および抽出日時が記録されています。このブロックは、**認証情報ではありません**。ルール14（エンジンによる微分再計算）が、ヘルパーによって生成されたすべてのサイドカーファイルに対する基準となります。`source_hash` が改ざんされた場合や、正しくない場合、または存在しない場合でも、ルール14は適用されます。信頼境界に関する記述、禁止事項、9つの攻撃的なデータセットのカタログ、およびpipによる配布を禁止する契約については、[`docs/live-helpers.md`](./docs/live-helpers.md) をご確認ください。

**サポート対象 (v0.10.x)**: PyTorch SGD、Adam、AdamW、およびsgd_momentum（古典的、Nesterov、減衰付き。`momentum_buffer` の ascent→descent の符号反転は、[PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099) で参照）。CPU優先。単一ステップと複数ステップに対応。
**境界でサポート対象外**: AMP/autocast、CUDA/MPS/XLA、SGDと結合されたL2重み減衰、AMSGrad/NAdam/RAdam/Lion/LBFGS、および複数隠れ層のトポロジー。これらのフレームワーク/最適化アルゴリズムに対する手動で作成されたサイドカーファイルは、標準の `bp import` パスを使用して引き続き機能します。

## このツールの機能範囲

- **実験追跡機能ではありません。** [MLflow](https://mlflow.org)、[Weights & Biases](https://wandb.ai)、[TensorBoard](https://www.tensorflow.org/tensorboard) などのツールを使用してください。これらのツールはログを記録します。`backprop-trace` は、内部的な整合性が保たれているかどうかを再計算します。
- **学習証明 (Proof-of-Learning) や zkML ではありません。** [PoL](https://arxiv.org/abs/2103.05633) は、実際の学習において偽造可能であることが示されています ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567))。zkML は暗号的な証明を生成します。`backprop-trace` は暗号化を使用せず、単一ステップで実行され、対象は人間またはCIのレビュー担当者です。
- **サプライチェーンの信頼性保証機能ではありません。** [Sigstore model-signing](https://github.com/sigstore/model-transparency)、[SLSA-for-models](https://slsa.dev)、[CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) は、パイプラインの信頼性を保証します。`backprop-trace` は、数値的な整合性を保証します。ML-BOM は、`backprop-trace` の結果を内部整合性の条件として参照できます。

## 脅威モデル

対象範囲: 拒否されるべきだが受け入れられてしまう場合 — スキーマのバイパス、NaN/Infinity による汚染、正準出力の乖離、循環性の違反、エンジン再計算におけるサイドカーとの不一致。 範囲外: 学習自体や、検証プロセスに対するサイドチャネル攻撃。 決定性は制限されます。同一の `backprop-trace` バージョン、Node.js 22.x、および同一の正準出力仕様においてのみ、バイト単位の同一出力が保証されます。 詳細な情報と公開スケジュールについては、[SECURITY.md](./SECURITY.md) を参照してください。

## インストール

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Node 22.x に固定 (V8 fdlibm `Math.exp` の決定性は重要 — `docs/computation-order.md` を参照)。

## CLI (コマンドラインインターフェース)

詳細な参照: [`docs/cli.md`](./docs/cli.md)。

| コマンド | 目的 |
|---|---|
| `bp reconcile receipt <file>` | 26 個のすべてのルールを実行し、最初の失敗で終了コード 1 を返す |
| `bp verify mazur` | バンドルされた Mazur テストスイートに対する完全な検証 |
| `bp verify general <file>` | 汎用的な検証 (v0.2+ の結果: XOR、iris、softmax+CE、observerモード) |
| `bp verify multi <file.jsonl>` | 複数のレコードを持つ JSONL ファイルと、レコード間のルール 9/10 の検証 |
| `bp generate {mazur,xor,iris}` | 指定されたエンジンを再実行し、正準バイトを出力する |
| `bp generate from-config <file>` | トポロジーと入力を含む JSON ファイルからエンジンを再実行する |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | 入力設定ファイルのテンプレートを作成する |
| `bp validate-input <file>` | トポロジーと入力設定ファイルをスキーマ検証する |
| `bp validate <file>` | 結果ファイルをスキーマ検証する (v0.1～v0.7 を自動的に検出) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | 外部フレームワークのトレースをインポートする |
| `bp examples pytorch [--print]` | バンドルされた PyTorch ヘルパーのパスを表示する (または内容を表示する) |

共通のオプション: `--out <ファイル名>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, ファイル引数 `-` は標準入力。 終了コード: `0` は成功、`1` は検証エラー、`2` は使用方法/I/O エラー、`3` は無効な CLI 引数、`4` はフレームワークが実装されていない。

## ライブラリ

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

サブパスのインポート: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, およびスキーマ関連のファイル `./schema/...`.

## 26 個のルール

詳細な説明と敵対的なテストケース: [`docs/reconciliation.md`](./docs/reconciliation.md)。

| # | ルール |
|---|---|
| 0 | 構造的なエラーの検出 (スキーマレベル) |
| 0.8 | 確率の範囲 — softmax の出力が [0, 1] の範囲内であること |
| 1-4 | エラー信号 (出力、後続の層、隠れ層) と、更新勾配の一貫性 |
| 5-7 | 更新値、重みの変化、最終状態 (AdamW の場合、ルール 6/7 で重み減衰を分離) |
| 8 | Provenance (データの出所) の参照の一貫性 |
| 9-10 | 複数のパラメータの連鎖とトレースの一致 |
| 11-13 | softmax の正規化、損失関数、および双対形式 (GATED) |
| 14 | エンジン再計算微分（オブザーバーモードでのインポート時は必須） |
| 15-17 | スキップベース + 署名付きダイジェスト結合 + バンドルルート結合（条件付き） |
| 18-19 | バッチ削減の一貫性 + サンプルセットの整合性（条件付き） |
| 20 | 最適化器の状態形状（Adam `{m, v}` / sgd_momentum `{buffer}`） |
| 21 | **PyTorch スタイルの SGD モメンタム**: 21a バッファ再帰 + 21b 効果的な方向 + 21c パラメータ更新 |
| 22-24 | Adam モメンタム再帰 + バイアス補正 + パラメータ更新（epsilon は sqrt の外側） |
| 25-26 | マルチステップ最適化器の状態チェーン + 最適化器設定の一貫性 |

## 決定論の範囲

Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x に対して、バイト単位で一致する検証済みデータ（Mazur, XOR, iris, softmax+CE, マルチステップ, バッチ処理, 外部サイドカー）を使用。Mazur のアンカー値 `post_update_loss.total = 0.29102777369359933`。エンジンによって生成されたデータに対して、`atol=1e-12`、`rtol=1e-9` の範囲内でルールごとの整合性を検証。

検証対象外: クロスエンジン（Bun, Deno, ブラウザ）、Node のメジャーバージョン 24.x 以降、任意の V8 のマイナーバージョンアップ。`Math.exp(-0.5)` が、V8 の fdlibm のずれを検知するための指標として、すべての CI 環境で動作します。

## このバージョンに含まれていないもの（現時点では）

backprop-trace v0.11.0 は、npm で公開された最初のバージョンですが、**まだ v0.x の段階**です。エンジン、リコンサイラー、正規出力の契約、外部インジェストパス、および PyTorch ライブヘルパーは、実用的なものであり、安定しています。v1.0 にするには、以下の機能が不可欠です。

- **異種マルチフレームワークトレース**: シングルフレームワークのバンドルのみをサポート。異なるフレームワークのストリームはサポートされていません。*スコープから外れる可能性があります。*
- **マルチステップトレースにおけるプロデューサーIDの結合**: ルール 17 は、バンドルの整合性エラーを検出しますが、プロデューサーの認証は検証しません。ルール 16 / Sigstore / アウトオブバンド認証と組み合わせて使用します。オペレーターのインターフェースであり、組み込み機能ではありません。
- **SGD に結合された L2 重み減衰**: ルール 7 の 3 番目のブランチ。*v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / パラメータグループごとの設定 / 学習率スケジューリング / 勾配クリッピング / 混合精度**: *v0.10+.*
- **バッチレシートにおけるサンプルごとの勾配**: 現在は、勾配を削減する機能のみ。サンプルごとの分解は、影響分析に役立ちます。*v0.10.x / v0.11.*
- **ステップごとの異種バッチサイズ**: ストリームごとに固定されたバッチサイズ。*スコープから外れる可能性があります。*
- **JAX / TensorFlow ライブヘルパー**: 手動で作成されたサイドカーは動作しますが、ライブヘルパーは *v0.11 (JAX, adopter-pull がトリガー) / v0.12+ (TF)* です。
- **実世界のテストケース**: Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur が重要な要素です。小規模な CNN / Transformer ブロックのテストケースは *v0.11.* です。
- **アダプターの検証**: 外部の研究事例、コースでの導入事例、および実環境でのコンプライアンスバンドルは存在しません。*v1.0 の前に v0.12 にする必要があります。*
- **GPU の決定性**: スコープ外であり、恒久的な問題である可能性が高い（cuDNN ConvolutionBackwardFilter のアトミック操作は、ビット単位での正確性を損なう [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)）。製品のターゲットは、決定的な CPU 環境です。

これらの機能のいずれかにワークフローが依存している場合は、このバージョンはまだ適していません。

## カスタムのトポロジーを定義する

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

[`docs/authoring.md`](./docs/authoring.md) を参照してください。入力とレシートのスキーマ、正規出力の信頼境界について説明されています。

## このソフトウェアがどのように位置づけられるか

- **再現性を重視した論文の著者** (NeurIPS/ICML/CoLLAs; [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)に対応) — レビュー担当者が30秒で確認できる、各ステップごとの再現可能な証拠。
- **機械学習教育** (Karpathyのゼロからヒーロー、大学の深層学習コース、面接対策) — すべての要素が可視化された、名前付きのトレーニングステップと、意図的に破壊された設定を*拒否する*機能。
- **機械学習フレームワーク/コンパイラエンジニア** (PyTorch / JAX / MLIR / XLAの貢献者) — 微分テストのための、各演算ごとに検証済みのトレース情報。
- **機械学習のコンプライアンス/監査エンジニア** ([EU AI Act Article 10](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — モデルの署名の下に、各ステップごとの記録が添付され、モデルカードまたは監査パッケージに紐付けられます。

## 法規のスタック

`docs/canonical-emission.md` に記載されています。

> コントラクトはエンジンよりも優先されます。フォーマッタのポリシーは、実行時のフォーマットよりも優先されます。不正なレシートは、正しいレシートよりも優先されます。実行時のフォーマットは、Mazurよりも優先されます。Mazurは、診断よりも優先されます。

## リンク

- [`docs/quickstart.md`](./docs/quickstart.md) — 5分間のチュートリアル
- [`docs/cli.md`](./docs/cli.md) — `bp`サブコマンドのリファレンス
- [`docs/live-helpers.md`](./docs/live-helpers.md) — v0.10のライブPyTorchヘルパー：ワークフロー、信頼境界、敵対的攻撃カタログ、pipを使用しない理由
- [`docs/authoring.md`](./docs/authoring.md) — カスタムトポロジーの作成
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 26の調整ルールを詳細に解説
- [`docs/topology.md`](./docs/topology.md) — 一般的なトポロジーの作成
- [`docs/multi-step.md`](./docs/multi-step.md) — 複数ステップのトレーニング記録
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — バイトレベルのエンコーディング契約
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754の順序付け; FMAの禁止; 決定性の境界
- [`docs/schema.md`](./docs/schema.md) — フィールドごとのスキーマ解説
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1の認証機能
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 循環参照を防ぐ仕組み; 良い記録が悪い記録よりも優先される原則
- [`SECURITY.md`](./SECURITY.md) — 検証者が脆弱性として認識するものの定義
- [`CHANGELOG.md`](./CHANGELOG.md) — バージョンごとの変更履歴

## ライセンス

MIT — [LICENSE](./LICENSE) を参照してください。

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
