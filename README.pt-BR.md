<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Um verificador determinístico de 26 regras para etapas de treinamento de redes neurais. Você fornece a ele um registro que lista todos os fatores que contribuíram para uma única atualização do gradiente; o verificador rederiva cada afirmação e rejeita em caso de discordância. Isso segue a filosofia de *"o oráculo não deve consultar o artefato que está julgando"*.

> **Status: versão inicial publicável (v0.11.0) — versão mid-v0.** Apenas para CPU. O verificador cobre SGD + Adam + AdamW + momentum do SGD no estilo PyTorch (clássico + Nesterov + amortecimento).
> Um utilitário PyTorch (disponível em `scripts/extract/pytorch.py`) cobre a mesma matriz de otimizadores. Apenas um observador — a [Regra 14](./docs/reconciliation.md) é a autoridade.
> A versão 0.11 é a primeira versão publicada via npm; a versão 1.0 ainda depende da [validação com exemplos do mundo real + validação do usuário + utilitários de execução em vários frameworks](#whats-not-in-this-version-yet). Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) antes de usar em produção.

## Início rápido em 30 segundos

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

O Mazur 2-2-2 é a análise passo a passo de retropropagação mais citada na web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Cada número nele pode ser derivado manualmente.

## O que é isso

Um verificador de correção numérica para uma única etapa de treinamento. O verificador aplica 26 regras que rederivam cada afirmação a partir dos fatores especificados. Se qualquer regra apresentar uma discordância dentro da tolerância híbrida (`atol + rtol`), o registro é rejeitado. Regras para etapas múltiplas (Regras 9 + 10), processamento em lote (Regras 18 + 19), recorrências do momento do Adam (Regras 22-24), recorrências do momento do SGD (Regras 20 + 21a/21b/21c + 25 + 26) e recálculo diferencial do motor a partir de rastreamentos de frameworks importados (Regra 14) cobrem as áreas relevantes para a produção.

Ele **não** valida a execução completa do treinamento, prova que o modelo está correto, nem substitui um rastreador de experimentos. Ele prova que cada etapa registrada é matematicamente consistente e que a cadeia está intacta. Corpora adversários comprovam a validade de um verificador ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — cada regra é fornecida com um exemplo defeituoso correspondente em [`fixtures/bad/`](./fixtures/bad) que o verificador deve rejeitar *antes* de ler qualquer metadado `fixture_status`.

## Utilitário PyTorch (v0.10+)

Um único arquivo Python auditável. Por design, não é um pacote pip — copie-o para o seu repositório, leia-o e execute-o.

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

O utilitário gera um arquivo auxiliar `framework-trace.v0.7.0` com um bloco forense `helper` (nome, versão, hash da origem, versão do framework, runtime, carimbo de data/hora da extração). Este bloco **não é uma credencial** — a Regra 14 (recálculo diferencial do motor) é a autoridade para cada arquivo auxiliar gerado, independentemente do que o utilitário afirma. Um `source_hash` falsificado/incorreto/ausente **não** ignora a Regra 14. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) para a declaração de limite de confiança, a lista de itens proibidos, o catálogo de exemplos adversários de 9 itens e o contrato de sinalização de distribuição sem pip.

**Suportado (v0.10.x)**: PyTorch SGD + Adam + AdamW + sgd_momentum (clássico/Nesterov/amortecimento, com a inversão de sinal do momento `momentum_buffer` conforme [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099)). Prioridade para CPU. Etapas únicas e múltiplas.
**Rejeitado na fronteira**: AMP/autocast, CUDA/MPS/XLA, SGD com decaimento de peso acoplado L2, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologias de múltiplas camadas ocultas. Arquivos auxiliares criados manualmente para esses frameworks/otimizadores continuam a funcionar através do caminho padrão `bp import`.

## O que isso não é

- **Não é um rastreador de experimentos.** Utilize [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) — essas ferramentas registram informações; o "backprop-trace" verifica se a matemática é internamente consistente.
- **Não é uma prova de aprendizado (Proof-of-Learning) ou zkML.** A [PoL](https://arxiv.org/abs/2103.05633) foi demonstrada como sendo falsificável em treinamento real ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); o zkML produz provas criptográficas. O "backprop-trace" não é criptográfico, é uma verificação passo a passo, destinada a ser analisada por humanos ou por revisores em sistemas de integração contínua (CI).
- **Não é uma atestação da cadeia de suprimentos.** [Sigstore model-signing](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) atestam a origem do processo; o "backprop-trace" atesta a consistência numérica. Um ML-BOM pode referenciar um "receipt" do "backprop-trace" como um predicado de consistência interna.

## Modelo de ameaças

Abrangência: qualquer "receipt" que deveria ser rejeitado, mas é aceito — bypass de esquema, envenenamento por NaN/Infinity, divergência na emissão canônica, violações de anti-circularidade, divergências na recomputação do "engine" em "sidecars" importados. Fora do escopo: confiabilidade da própria execução de treinamento, ataques de canal lateral no processo de verificação. O determinismo é limitado: a saída byte a byte é garantida apenas para a mesma versão do "backprop-trace", Node.js 22.x e a mesma especificação de emissão canônica. Consulte [SECURITY.md](./SECURITY.md) para a lista completa e o cronograma de divulgação.

## Instalação

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fixado na versão 22.x do Node (o determinismo de `Math.exp` da V8 fdlibm é crucial — veja [`docs/computation-order.md`](./docs/computation-order.md)).

## Interface de Linha de Comando (CLI)

Referência completa: [`docs/cli.md`](./docs/cli.md).

| Comando | Propósito |
|---|---|
| `bp reconcile receipt <file>` | Executa todas as 26 regras; sai com código 1 na primeira falha. |
| `bp verify mazur` | Verificação completa no "fixture" Mazur incluído. |
| `bp verify general <file>` | Verificação generalizada (receitas v0.2+: XOR, iris, softmax+CE, observer-mode). |
| `bp verify multi <file.jsonl>` | Múltiplos registros JSONL + Regras 9/10 entre registros. |
| `bp generate {mazur,xor,iris}` | Reexecuta o "engine" especificado, emite bytes canônicos. |
| `bp generate from-config <file>` | Reexecuta o "engine" a partir de uma topologia e entrada em formato JSON. |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | Cria uma configuração inicial. |
| `bp validate-input <file>` | Valida o esquema de uma topologia e entrada. |
| `bp validate <file>` | Valida o esquema de um "receipt" (detecta automaticamente as versões v0.1-v0.7). |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Importa um "trace" de um framework externo. |
| `bp examples pytorch [--print]` | Imprime o caminho (ou exibe o conteúdo) do "helper" PyTorch incluído. |

Flags comuns: `--out <arquivo>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, o argumento de arquivo `-` representa a entrada padrão (stdin). Códigos de saída: `0` (sucesso) · `1` (falha na verificação) · `2` (uso/I-O) · `3` (argumento CLI inválido) · `4` (framework não implementado).

## Biblioteca

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

Importações de subdiretórios: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, além da família de esquemas `./schema/...`.

## As 16 regras

Declarações completas + "fixtures" adversariais: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regra |
|---|---|
| 0 | Sentinela de falha estrutural (nível de esquema) |
| 0.8 | Limites de probabilidade — saídas softmax no intervalo [0, 1] |
| 1-4 | Sinais de erro (saída, downstream, ocultos) + consistência do gradiente atualizado. |
| 5-7 | Atualiza o valor, a progressão do peso e o estado final (ramificação AdamW para "weight decay" desacoplado nas Regras 6/7). |
| 8 | Consistência da referência de origem |
| 9-10 | Cadeia de parâmetros de múltiplos passos + identidade do "trace". |
| 11-13 | Normalização softmax + fórmula de perda + forma dual (GATED). |
| 14 | Diferencial de recomputação do "engine" (OBRIGATÓRIO em "observer-mode"). |
| 15-17 | Base de "skip" + ligação de "digest" assinado + ligação da raiz do "bundle" (GATED). |
| 18-19 | Consistência da redução em lote + coerência do conjunto de amostras (GATED). |
| 20 | Formato do estado do otimizador (Adam `{m, v}` / sgd_momentum `{buffer}`). |
| 21 | **Momento SGD no estilo PyTorch**: 21a recorrência do buffer + 21b direção efetiva + 21c atualização do parâmetro. |
| 22-24 | Adam: recorrências de momento + correção de viés + atualização de parâmetros (epsilon FORA da raiz quadrada). |
| 25-26 | Corrente de estados do otimizador de múltiplas etapas + constância da configuração do otimizador. |

## Escopo do determinismo

Contratual para Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x: valores padrão idênticos por byte (Mazur, XOR, iris, softmax+CE, multi-step, em lote, sidecars externos); a âncora Mazur `post_update_loss.total = 0.29102777369359933`; reconciliação por regra dentro de `atol=1e-12`, `rtol=1e-9` para elementos criados pelo motor.

NÃO contratual: entre motores (Bun, Deno, navegadores); entre versões principais do Node (24.x+); incrementos arbitrários da versão secundária do V8. Um "canary" `Math.exp(-0.5)` é acionado em cada célula do CI como um alarme de derivação do fdlibm do V8.

## O que não está nesta versão (ainda)

A versão v0.11.0 do backprop-trace é a primeira versão publicada no npm, mas ainda está na fase **mid-v0**. O motor, o reconciliador, o contrato de emissão canônica, o caminho de ingestão externo e o helper de execução do PyTorch são reais e estáveis. A versão 1.0 requer que os seguintes itens sejam concluídos:

- **Traços de estruturas de múltiplos frameworks** — apenas pacotes de estruturas de um único framework; fluxos de estruturas mistas não são suportados. *Pode permanecer fora do escopo.*
- **Vinculação de identidade do produtor em traços de múltiplas etapas** — a Regra 17 detecta falhas de integridade do pacote, mas não a autenticidade do produtor. Combine com a Regra 16 / Sigstore / atestado fora de banda. Superfície de operação, não um recurso integrado.
- **Decaimento de peso L2 acoplado ao SGD** — terceiro ramo da Regra 7; *v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / grupos de parâmetros por parâmetro / agendamentos de taxa de aprendizado / recorte de gradiente / precisão mista** — *v0.10+.*
- **Gradientes por amostra em recibos em lote** — apenas gradientes reduzidos atualmente; a decomposição por amostra é útil para auditorias de influência. *v0.10.x / v0.11.*
- **Tamanhos de lote heterogêneos entre etapas** — tamanho de lote fixo por fluxo. *Pode permanecer fora do escopo.*
- **Helpers de execução do JAX / TensorFlow** — sidecars criados manualmente funcionam; os helpers de execução são *v0.11 (JAX, trigger do adopter-pull) / v0.12+ (TF).*
- **Fixture de uso real** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur são os destaques; a pequena fixture de CNN / bloco de transformador é *v0.11.*
- **Validação do adotador** — nenhum estudo de caso de pesquisador externo, nenhuma adoção em curso, nenhum pacote de conformidade no mundo real. *v0.12 antes da v1.0.*
- **Determinismo da GPU** — fora do escopo e provavelmente permanente (as operações atômicas de convolução do cuDNN derrotam a exatidão de bit por bit, conforme [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). A posição do produto é o canto determinístico da CPU.

Se o seu fluxo de trabalho depende de alguma dessas funcionalidades, esta não é a versão certa para você ainda.

## Crie uma topologia personalizada

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulte [`docs/authoring.md`](./docs/authoring.md) — esquemas de entrada versus recibos, limite de confiança de emissão canônica.

## Onde isso se encaixa

- **Autores de artigos focados em reprodutibilidade** (NeurIPS/ICML/CoLLAs; cientes do [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) — evidências deriváveis por etapa que o revisor executa em 30 segundos.
- **Pedagogia de aprendizado de máquina** (Karpathy zero-to-hero, cursos de DL universitários, preparação para entrevistas) — uma única etapa de treinamento nomeada com todos os fatores visíveis e um reconciliador que *rejeita* fixtures intencionalmente corrompidos.
- **Engenheiros de frameworks / compiladores de aprendizado de máquina** (PyTorch / JAX / MLIR / contribuidores do XLA) — traço conhecido por operação para testes diferenciais.
- **Engenheiros de conformidade / auditoria de aprendizado de máquina** ([Artigo 10 da Lei de IA da UE](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — recibo por etapa abaixo da assinatura do modelo, anexado a um cartão de modelo ou pacote de auditoria.

## A pilha de leis

De `docs/canonical-emission.md`:

> O contrato precede o motor. A política de formatação precede a formatação em tempo de execução. Os recibos inválidos precedem os recibos válidos. A formatação em tempo de execução precede o Mazur. O Mazur precede os diagnósticos.

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — Tutorial rápido de cinco minutos.
- [`docs/cli.md`](./docs/cli.md) — Referência do subcomando `bp`.
- [`docs/live-helpers.md`](./docs/live-helpers.md) — Utilitários "live" para PyTorch versão 0.10: fluxo de trabalho, limite de confiança, catálogo de exemplos adversariais, justificativa para não usar `pip`.
- [`docs/authoring.md`](./docs/authoring.md) — Como criar uma topologia personalizada.
- [`docs/reconciliation.md`](./docs/reconciliation.md) — As 26 regras de reconciliação em detalhes.
- [`docs/topology.md`](./docs/topology.md) — Criação de topologias gerais.
- [`docs/multi-step.md`](./docs/multi-step.md) — Instruções para treinamento em várias etapas.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrato de codificação em nível de byte.
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordem de operações IEEE 754; proibição de FMA; limite de determinismo.
- [`docs/schema.md`](./docs/schema.md) — Explicação detalhada do esquema, campo por campo.
- [`docs/attestation.md`](./docs/attestation.md) — Mecanismo de atestado "in-toto" versão 1.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Mecanismo para evitar circularidade; princípio de que "receitas ruins devem preceder receitas boas".
- [`SECURITY.md`](./SECURITY.md) — O que constitui uma vulnerabilidade para um verificador.
- [`CHANGELOG.md`](./CHANGELOG.md) — Histórico de versões.

## Licença

MIT — veja [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
