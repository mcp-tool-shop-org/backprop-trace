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

ニューラルネットワークの学習ステップに対する、決定的な26個のルールを持つ検証器。この検証器には、ある勾配更新に寄与したすべての要素を記述したログを提供します。そして、再調整器がすべての主張を再検証し、矛盾がある場合は拒否します。『オラクルは、自身が評価するアーティファクトを参照してはならない』というCsmith/CompCertの系譜における原則に従います。

> **v1.0.0 — CPU専用、決定的な検証**。この検証器は、SGD、Adam、AdamW、SGD-momentum（古典的／ネステロフ／ダンピング）、および26個の再調整ルールにわたる**SGD結合L2重み減衰**をカバーします。ライブの**PyTorchとJAX**ヘルパーが、実際の学習ステップを検証可能なログに抽出します。これは観察者専用であり、[Rule 14](./docs/reconciliation.md)がすべてのインポートされたサイドカーに関する権限を持ちます。940個の決定的なテスト、検証器によって定義された許容範囲の上限、および循環防止メカニズムを備えています。本番環境で使用する前に[`docs/live-helpers.md`](./docs/live-helpers.md)を参照し、バージョン履歴については[CHANGELOG](./CHANGELOG.md)を確認してください。

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

Mazur 2-2-2は、オープンなウェブ上で最も引用されている単一ステップの逆伝播の説明です（[Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)）。その中のすべての数値は、手動で検証できます。

## これは何なのか

単一の学習ステップに対する数値的な正確性を検証するものです。再調整器は、名前が付けられた要素から各主張を再検証する26個のルールに従います。いずれかのルールがハイブリッド許容範囲（`atol + rtol`）内で矛盾する場合、ログは拒否されます。複数ステップ（ルール9 + 10）、バッチ処理（ルール18 + 19）、Adamモーメントの再帰（ルール22-24）、SGDモーメントの再帰（ルール20 + 21a/21b/21c + 25 + 26）、およびインポートされたフレームワークトレースに対するエンジンによる再計算（ルール14）は、本番環境に関連する範囲をカバーします。

これは、全体的な学習実行を検証したり、モデルが正しいことを証明したり、実験トラッカーに置き換えたりするものではありません。各記録されたステップが数学的に一貫しており、チェーンが損なわれていないことを証明します。敵対的データセットは、検証器の有効性を示します（[Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)）。すべてのルールには、[`fixtures/bad/`](./fixtures/bad)にペアで格納された不良のテストケースが付属しており、検証器は`fixture_status`メタデータを読み取る前に、それを拒否する必要があります。

## ライブPyTorchヘルパー（v0.10以降）

監査可能な単一のPythonファイル。設計上、pipパッケージはありません。リポジトリにコピーし、読み込み、実行してください。

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

このヘルパーは、フォレンジックな`helper`ブロック（名前、バージョン、ソースハッシュ、フレームワークバージョン、ランタイム、抽出タイムスタンプ）を含む`framework-trace.v0.7.0`サイドカーを出力します。このブロックは**認証情報ではありません**。ルール14（エンジンによる再計算）が、ヘルパーが主張する内容に関係なく、すべてのヘルパーによって出力されるサイドカーの権限を持ちます。偽造された/誤った/欠落した`source_hash`は、ルール14を回避しません。信頼境界に関する記述、禁止リスト、9個のテストケースを含む敵対的カタログ、およびpipによる配布なしの契約については、[`docs/live-helpers.md`](./docs/live-helpers.md)を参照してください。

**サポート対象**: PyTorch SGD + Adam + AdamW + sgd_momentum（古典的／ネステロフ／ダンピング）+ **SGD結合L2重み減衰**。`momentum_buffer`の方向転換（上昇→下降）は、[PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099)に従います。CPUを優先します。単一ステップと複数ステップの両方をサポートします。より強力な信頼境界を持つ、並列の**ライブJAXヘルパー**（`scripts/extract/jax.py`）は、SGD + Adamをカバーします。これは、`jax.make_jaxpr(jax.grad(loss))`ダイジェストをフォレンジックブロックに折り込みます（PyTorchのイージーモードには見られない、検査可能な勾配グラフ）。また、`jax_enable_x64`とCPUがなければ実行されません。詳細については、[`docs/live-helpers.md`](./docs/live-helpers.md)を参照してください。
**境界で拒否**: AMP/autocast、CUDA/MPS/XLA、AMSGrad/NAdam/RAdam/Lion/LBFGS、多層隠れ層トポロジー。これらのフレームワーク/オプティマイザーに対する手動作成のサイドカーは、標準の`bp import`パスを介して引き続き機能します。

## これは何ではないのか

- **実験トラッカーではありません**。[MLflow](https://mlflow.org)、[Weights & Biases](https://wandb.ai)、[TensorBoard](https://www.tensorflow.org/tensorboard)を使用してください。これらは主張を記録します。バックプロパゲーショントレースは、数学的な整合性を内部的に検証します。
- **Proof-of-LearningやzkMLではありません**。[PoL](https://arxiv.org/abs/2103.05633)は、実際の学習で偽造可能であることが示されました（[Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)）。zkMLは暗号化された証明を生成します。バックプロパゲーショントレースは非暗号化であり、単一ステップで、対象者は人間またはCIレビュー担当者です。
- **サプライチェーンの認証ではありません**。[Sigstore model-signing](https://github.com/sigstore/model-transparency)、[SLSA-for-models](https://slsa.dev)、[CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/)は、パイプラインの出所を認証します。バックプロパゲーショントレースは、数値的な整合性を認証します。ML-BOMは、内部整合性の述語としてバックプロパゲーショントレースログを参照できます。

## 脅威モデル

対象範囲：拒否されるべきだが受け入れられるログ（スキーマのバイパス、NaN/Infinityによる汚染、カノニカル出力のずれ、循環防止違反、インポートされたサイドカーに対するエンジンによる再計算の不一致）。対象外：学習実行自体の信頼性、検証プロセスに対するサイドチャネル攻撃。決定性は限定的です。バイト単位で同一の出力は、同じバックプロパゲーショントレースバージョン、Node.js 22.x、および同じカノニカル出力仕様でのみ保証されます。完全な列挙と開示タイムラインについては、[SECURITY.md](./SECURITY.md)を参照してください。

## インストール

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Node 22.xに固定（V8 fdlibm `Math.exp`の決定性が重要です。詳細については、[`docs/computation-order.md`](./docs/computation-order.md)を参照）。

## CLI

完全なリファレンス：[`docs/cli.md`](./docs/cli.md)。

| 動詞 | 目的 |
|---|---|
| `bp reconcile receipt <file>` | 26個すべてのルールを実行し、最初の失敗時に1を返して終了します。 |
| `bp verify mazur` | バンドルされたMazurのテストケースに対して完全なゲートを行います。 |
| `bp verify general <file>` | 汎用ゲート（v0.2+、検証対象：XOR、iris、softmax+CE、オブザーバーモード） |
| `bp verify multi <file.jsonl>` | 複数レコードのJSONL + レコードをまたぐルール（9/10） |
| `bp generate {mazur,xor,iris}` | 指定されたエンジンを再実行し、標準化されたバイト列を出力する |
| `bp generate from-config <file>` | トポロジーと入力JSONからエンジンを再実行する |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | 初期入力設定ファイルを記述する |
| `bp validate-input <file>` | トポロジーと入力設定ファイルのスキーマ検証を行う |
| `bp validate <file>` | 検証対象のスキーマを検証する（v0.1～v0.7を自動検出） |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | 外部フレームワークのトレースを取り込む |
| `bp examples {pytorch,jax} [--print]` | バンドルされたライブPyTorch / JAXヘルパーのパスを出力する（または内容を表示する） |

一般的なフラグ：`--out <ファイル>`、`--json`、`--verbose`/`-V`、`--color=auto\|never\|always`、ファイル引数 `-` = 標準入力。終了コード：`0`（成功）、`1`（検証失敗）、`2`（使用方法/I-Oエラー）、`3`（無効なCLI引数）、`4`（フレームワークが実装されていない）。

## ライブラリ

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

> **どのゲートが何を証明するか。** `reconcileReceipt`は、検証対象の計算結果が
> *内部的に整合性がある*ことを証明する（26個のルールが、検証対象の独自の要素から各主張を再導出する）。**起源不明**の検証対象の場合、エンジン再現ゲートとペアにする—`verifyEngineReproduces`（または`bp verify general`）で、これは検証対象の入力から決定論的なエンジンを再実行し、フィールドごとに比較する。この2番目のゲートが、循環性を回避するための枠組みを完成させる：内部整合性だけでは、エンジンによって作成されたものとして再ラベル付けされた外部の検証対象を検出することはできない。なぜなら、各検証対象ごとのルールは、エンジンによって作成された検証対象に対するフォワードパスを再導出しないからである。オブザーバーモードインポート（`importPytorchSidecar`）は、エンジン再現差分（ルール14）を自動的に実行する。`bp verify`は常に両方のゲートを実行する。

サブパスインポート：`./reconcile`、`./engine`、`./general-engine`、`./mazur`、`./topology`、`./activations`、`./emit`、`./validate`、`./parse`、`./parse-input`、`./hash`、`./schema-loader`、`./verify-engine`、`./extract`、`./import-pytorch`、`./import-jax`、`./import-tensorflow`、`./import-observer`、およびスキーマファミリー `./schema/...`。

## 26個のルール

完全なステートメント + 敵対的テストケース：[`docs/reconciliation.md`](./docs/reconciliation.md)。

| # | ルール |
|---|---|
| 0 | 構造的な失敗を示すセンチネル（スキーマレベル） |
| 0.8 | 確率の範囲—softmax出力は[0, 1]の間 |
| 1-4 | エラー信号（出力、下流、隠れ層）+ 更新勾配の一貫性 |
| 5-7 | 更新値、重みの進行、最終状態（AdamWブランチをルール6/7に適用し、デカップリングされた重み減衰を実現） |
| 8 | 起源参照の一貫性 |
| 9-10 | 多段階のパラメータチェーン + トレースIDの一致 |
| 11-13 | softmax正規化 + 損失関数 + 二次形式（GATED） |
| 14 | エンジン再計算差分（オブザーバーモードインポートの場合に必須） |
| 15-17 | スキップベース + 署名付きダイジェストバインド + バンドルルートバインド（GATED） |
| 18-19 | バッチ削減の一貫性 + サンプルセットのコヒーレンス（GATED） |
| 20 | オプティマイザー状態の形状（Adam `{m, v}` / sgd_momentum `{buffer}`） |
| 21 | **PyTorchスタイルのSGDモーメンタム**: 21aバッファ再帰 + 21b有効方向 + 21cパラメータ更新 |
| 22-24 | Adamモーメント再帰 + バイアス補正 + パラメータ更新（イプシロンは平方根の外側） |
| 25-26 | 多段階のオプティマイザー状態チェーン + オプティマイザー設定の一貫性 |

## 決定論の範囲

Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.12.xにおいて契約により保証される：バイト単位で完全に一致するゴールデン値（Mazur、XOR、iris、softmax+CE、多段階、バッチ処理、外部サイドカー）。Mazurアンカー `post_update_loss.total = 0.29102777369359933`。エンジンによって作成されたものについては、`atol=1e-12`、`rtol=1e-9`で各ルールの整合性を検証する。

契約により保証されない：クロスエンジン（Bun、Deno、ブラウザ）、Nodeのメジャーバージョンが異なる場合（24.x+）、任意のV8マイナーアップデート。すべてのCIセルで、`Math.exp(-0.5)`カナリアテストを実行し、V8のfdlibmドリフトを検知する。

## このバージョンにはまだ含まれていないもの

v1.0.0は、決定論的なCPU環境でエンドツーエンドに動作するように設計されている：エンジン、整合性検証ツール、標準化された出力契約、外部入力パス、ライブPyTorch **および** JAXヘルパー、結合されたL2重み減衰を含むSGDファミリーのオプティマイザー、認識可能な主要なテストケース、および[コンプライアンスバンドル](./docs/compliance.md)。以下に示すロードマップは、**意図的にまだカバーされていないもの**であり、使用頻度×検証可能性の順に並べられ、それぞれが整合性検証ツールが実際に所有できるクローズドフォームのCPU再計算に基づいてゲートされている。

- **NAdam（オプションでRAdam）** - 安価なAdamのバリエーション。次に、すべてのオプティマイザーと組み合わせて使用できる**学習率スケジュールの検証**を行います。*次へ。*
- **AMSGrad / グローバルノルム勾配クリッピング / パーグループ学習率 / Lion** - それぞれが、レシート/リコンサイラー拡張に基づいて制御されます。*後で。*
- **Conv / 複数隠れ層のトポロジー** - エンジンは単一の隠れ層を持つ密結合層です。重要な要素は、認識可能な密結合ReLU→ソフトマックス分類器です。Convは、ビット決定性に対抗する融合カーネルFP順序を導入します（GPU以下を参照）。*CPUで決定的な結果を得るという制約から外れる可能性が高い。*
- **異種マルチフレームワークのトレース** - 単一のフレームワークバンドルのみ。複数のフレームワークのストリームはサポートされていません。*スコープから外れる可能性があります。*
- **ステップ間で異なるバッチサイズを持つ異種データ** - 各ストリームで固定された`batch_size`を使用します。*スコープから外れる可能性があります。*
- **バッチ処理されたレシート内のサンプルごとの勾配** - 現在は、勾配の削減のみを行います。サンプルごとの分解は、影響監査に役立ちますが、まだ公開されていません。*後で。*
- **複数ステップのトレースにおけるプロデューサーIDのバインディング** - ルール17は、バンドルの整合性の失敗を検出し、プロデューサーの信頼性を検証するものではありません。ルール16 / Sigstore / 外部認証と組み合わせます。これは、組み込み機能ではなく、オペレーターの表面です。
- **GPU / 融合カーネルによるビット決定性** - スコープ外であり、恒久的です。浮動小数点演算の非結合性により、融合/並列カーネル全体で正確なビット単位の一致を実現することは不可能です（[arXiv:2408.05148](https://arxiv.org/abs/2408.05148); cuDNN ConvolutionBackwardFilterアトミック演算については、[CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)を参照）。結果として得られるのは、決定的なCPU環境です。

これらのいずれかに依存している場合は、現時点ではこのバージョンは適切ではありません。

## カスタムトポロジーを作成する

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

[`docs/authoring.md`](./docs/authoring.md)を参照してください - 入力とレシートのスキーマ、標準的な出力信頼境界。

## この機能がどのように役立つか

- **再現性を重視する論文著者**（NeurIPS / ICML / CoLLAs; [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)を考慮） - レビュー担当者が30秒で実行できる、ステップごとの証拠を再構築可能にする。
- **機械学習の教育**（Karpathyによるゼロから始める方法、大学の深層学習コース、面接対策） - すべての要素が可視化され、意図的に壊された要素を*拒否する*リコンサイラーを備えた、名前付きの単一のトレーニングステップ。
- **機械学習フレームワーク/コンパイラエンジニア**（PyTorch / JAX / MLIR / XLAコントリビューター） - 差分テスト用の既知の良好なオペレーションごとのトレース。
- **機械学習のコンプライアンス/監査エンジニア**（[EU AI Act Annex IV §2(g)検証/テストログ + Article 15堅牢性](https://artificialintelligenceact.eu/annex/4/)；SLSA-for-ML） - モデル署名の下にある、検証可能で日付が記録され、署名可能なテストログレコードとして機能するステップごとのレシート。関連する[コンプライアンスバンドル](./docs/compliance.md)（および正直なスコープ：レシートは*数学*を証明し、データガバナンスを証明するものではありません）を参照してください。

## 法律の体系

`docs/canonical-emission.md`より：

> 契約はエンジンに先行します。フォーマッターポリシーは、実行時のフォーマットに先行します。悪いレシートは、良いレシートに先行します。実行時のフォーマットは、Mazurに先行します。Mazurは、診断に先行します。

## リンク

- [`docs/quickstart.md`](./docs/quickstart.md) - 5分間のウォークスルー
- [`docs/cli.md`](./docs/cli.md) - `bp`サブコマンドのリファレンス
- [`docs/live-helpers.md`](./docs/live-helpers.md) - v0.10のライブPyTorchヘルパー：ワークフロー、信頼境界、敵対的カタログ、pipを使用しない理由
- [`docs/authoring.md`](./docs/authoring.md) - カスタムトポロジーを作成する
- [`docs/reconciliation.md`](./docs/reconciliation.md) - 26のレコンサイラールールをすべて表示
- [`docs/topology.md`](./docs/topology.md) - 一般的なトポロジの作成
- [`docs/multi-step.md`](./docs/multi-step.md) - 複数ステップのトレーニングレシート
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) - バイトレベルのエンコーディング契約
- [`docs/computation-order.md`](./docs/computation-order.md) - IEEE 754順序; FMA禁止; 決定性の境界
- [`docs/schema.md`](./docs/schema.md) - フィールドごとのスキーマのウォークスルー
- [`docs/attestation.md`](./docs/attestation.md) - in-toto v1アテステーションシーム
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - 循環性のないラチェット; 悪いレシートが先にくるという原則
- [`SECURITY.md`](./SECURITY.md) - 検証者にとっての脆弱性とは何か
- [`CHANGELOG.md`](./CHANGELOG.md) - バージョンごとの履歴

## ライセンス

MIT - [LICENSE](./LICENSE)を参照してください。

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
