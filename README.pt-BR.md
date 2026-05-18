<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

Um verificador estrutural determinístico de rastreamento para etapas individuais de treinamento de redes neurais — um reconciliador com 16 regras que rederiva gradientes, sinais e atualizações de parâmetros a partir de fatores nomeados e gera recibos canônicos no formato JSONL. Inspirado nas linhas de Csmith/CompCert, que defendem que *"a entidade que avalia não deve consultar o artefato que está julgando."*

> **Status: versão mid-v0 (v0.7.0).** O motor principal e o reconciliador são reais e estão disponíveis. Funciona em uma única etapa, apenas com CPU, apenas com SGD e com uma única amostra. Atualmente, os rastreamentos de frameworks externos são criados manualmente. Consulte [O que não está nesta versão (ainda)](#whats-not-in-this-version-yet) antes de usar esta ferramenta para trabalhos de produção.

## Início rápido em 30 segundos

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

O Mazur 2-2-2 é o exemplo mais citado de análise passo a passo de retropropagação disponível na web (Matt Mazur, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). É um exemplo fundamental porque cada número nele pode ser derivado manualmente. Para o seu próprio rastreamento, consulte [Forneça seu próprio rastreamento de treinamento](#bring-your-own-training-trace).

## O que é isso

backprop-trace é um verificador de correção numérica para *uma única* etapa de treinamento de rede neural. Você fornece um recibo — um registro JSONL que nomeia todos os fatores que contribuíram para uma única atualização de gradiente — e o reconciliador aplica 16 regras que rederivam cada afirmação a partir dos fatores nomeados. Se alguma regra apresentar uma divergência dentro da tolerância híbrida (`atol + rtol`, forma máxima simétrica), o recibo é rejeitado.

A base teórica é Csmith (Yang, Chen, Eide, Regehr — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) e CompCert (Leroy, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)): corpora adversários provam a validade de um verificador, e testes aprovados não garantem isso. Cada regra do reconciliador é fornecida com um exemplo intencionalmente incorreto no diretório [`fixtures/bad/`](./fixtures/bad/) que o verificador deve rejeitar *antes* de ler quaisquer metadados do ciclo de vida `fixture_status`. Essa disciplina de anti-circularidade — a entidade que avalia não deve consultar o artefato que está julgando — é a propriedade fundamental.

## O que isso *não* é

- **Não é um rastreador de experimentos.** Se você deseja curvas de perda, painéis ou armazenamento de execuções de longo prazo, use [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai) ou [TensorBoard](https://www.tensorflow.org/tensorboard). Esses sistemas registram o que o treinador afirma que aconteceu. backprop-trace rederiva se a matemática é internamente consistente. São complementares, não sobrepostos.
- **Não é uma prova de aprendizado (Proof-of-Learning) ou zkML.** A abordagem Proof-of-Learning (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) foi demonstrada como sendo falsificável em treinamentos reais (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)). zkML/opML (EZKL, Modulus, ORA) gera provas criptográficas ou economicamente suportadas para liquidação on-chain sem confiança. backprop-trace não é criptográfico, funciona em uma única etapa e é destinado a um público humano ou a revisores de CI.
- **Não é uma atestação da cadeia de suprimentos.** [A assinatura de modelos do Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev) e [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) atestam que *o artefato X foi produzido pelo pipeline Y*. backprop-trace atesta que *esta atualização pode ser matematicamente derivada desses fatores*. São complementares — um ML-BOM pode referenciar um recibo backprop-trace como um predicado de consistência interna.

## Modelo de ameaças

`backprop-trace` é um verificador determinístico: o escopo inclui qualquer recibo que deveria ser rejeitado, mas é aceito — contorno do esquema, envenenamento por NaN/Infinito, divergência de emissão canônica, violações de anti-circularidade (o conciliador consulta o `fixture_status` antes de concluir as verificações de regras) e divergências na recomputação do motor em relação aos rastreamentos de framework importados. O que não está no escopo inclui a confiabilidade da própria execução de treinamento, a correção do modelo que está sendo treinado, ataques de canal lateral ou de temporização contra o processo de verificação e qualquer coisa além da decisão de aceitação do recibo. O determinismo é limitado: a saída idêntica em bytes é garantida apenas para a mesma versão do `backprop-trace`, a mesma versão principal do Node.js (atualmente 22.x) e a mesma versão de especificação de emissão canônica. A reprodução entre motores (Hermes, JSC, Bun-JSC) e entre versões principais do Node.js (24.x, 26.x, ...) não é um objetivo. O verificador confia no formato do recibo e no contrato de emissão canônica; ele não confia no produtor. Consulte [SECURITY.md](./SECURITY.md) para o cronograma de divulgação, a classificação de gravidade e a lista completa.

## Instalação

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Fixado na versão 22.x do Node (o determinismo de `Math.exp` da V8 fdlibm é crucial — veja [`docs/computation-order.md`](./docs/computation-order.md)).

## Uso da linha de comando

A versão 0.2 inclui quatro subcomandos. Referência completa: [`docs/cli.md`](./docs/cli.md).

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

Flags comuns (veja [`docs/cli.md`](./docs/cli.md)):

- `--out <file>` — escreve em um arquivo em vez de stdout
- `--json` — saída JSON legível por máquina (para sistemas de integração contínua)
- `--verbose`, `-V` — mensagens de diagnóstico no stderr antes da execução
- `--color=auto|never|always` — cor da saída; respeita a variável `NO_COLOR`
- O argumento de arquivo `-` lê da entrada padrão (`conciliar recibo`, `validar`, `verificar geral`)

Códigos de saída: `0` sucesso · `1` falha na verificação · `2` erro de uso ou de E/S · `3` argumento inválido da linha de comando · `4` framework não implementado.

## Uso da biblioteca

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

Importações de subdiretórios: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (topology-input), `./schema/framework-trace-0.1.0`.

## Forneça seu próprio rastreamento de treinamento

O caminho de ingestão externa v0.6 permite que usuários de PyTorch / JAX / TensorFlow verifiquem seus próprios rastreamentos de backprop de um único passo contra as mesmas 16 regras — mas **atualmente, o arquivo auxiliar é criado manualmente**. Ainda não existe um helper `pip install backprop-trace-pytorch`. Para criar um arquivo auxiliar:

1. Leia o esquema [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) — ele define um contrato JSONL para um único passo de treinamento (topologia + entrada + propagação direta + gradientes + parâmetros_antes + parâmetros_depois + rastreabilidade).
2. Extraia esses valores do seu passo de treinamento (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape` — todos expõem os valores numéricos necessários para cada tensor).
3. Emita o arquivo auxiliar como JSONL canônico (strings decimais, não floats binários — veja [`docs/canonical-emission.md`](./docs/canonical-emission.md)).
4. Execute `bp import pytorch <sidecar.jsonl>` (ou `import jax` / `import tensorflow`).
5. O importador produz um **recibo no modo de observador**: as afirmações do framework são armazenadas como campos canônicos; o motor `backprop-trace` recomputa o mesmo passo e executa a **Regra 14** como uma verificação diferencial. Divergência = seu extrator mentiu, ou seu framework mudou, ou algo está errado com o rastreamento.

Este é um fluxo de trabalho real atualmente, mas é complexo. Veja [O que não está nesta versão (ainda)](#whats-not-in-this-version-yet) para a lacuna de empacotamento de helper.

A disciplina de subcomandos por framework é imposta: `bp import pytorch` rejeita arquivos auxiliares JAX e vice-versa. Não há detecção automática (não há dependência de tempo de execução do framework neste pacote — por design).

## As 16 regras

| # | Regra |
|---|---|
| 0 | Sentinela de falha estrutural (nível de esquema) |
| 0.8 | Limites de probabilidade — saídas softmax no intervalo [0, 1] |
| 1 | Consistência do sinal de erro de saída |
| 2 | Contribuição para as camadas subsequentes e soma retropropagada |
| 3 | Consistência do sinal de erro oculto |
| 4 | Consistência do gradiente de atualização |
| 5 | Consistência do valor de atualização |
| 6 | Progressão dos pesos |
| 7 | Consistência do estado final |
| 8 | Consistência da referência de origem |
| 9 | Cadeia de parâmetros em várias etapas (`parameters_before[N]` = parâmetros anteriores `parameters_after[N-1]`) |
| 10 | Identidade de rastreamento em várias etapas (ID de rastreamento compartilhado + índice de etapa sequencial) |
| 11 | Normalização softmax (`sum(forward[output].out) == 1.0`) |
| 12 | Consistência da fórmula de perda (erro quadrático médio + ramos de entropia cruzada softmax) |
| 13 | Consistência de forma dupla (decomposição jacobiana softmax+CE; ATIVADO — dispara apenas quando `dual_form` está presente) |
| 14 | Diferencial de recálculo do motor (OBRIGATÓRIO para recibos importados no modo de observador) |
| 15 | Base de exclusão necessária (enum fechado `EXTERNAL_TRUST_BASIS`, 4 valores) |
| 16 | Vinculação de resumo de atestado (ATIVADO — dispara quando `attestor.signed_subject_digest` está presente) |

Declarações completas em [`docs/reconciliation.md`](./docs/reconciliation.md). Cada regra vem com um "bad fixture" correspondente em `fixtures/bad/`, de acordo com a doutrina Csmith.

## Escopo do determinismo

O que é contratual na matriz fixada (Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.7.x):

- Igualdade de bytes de `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl`
- "Golden" externos idênticos para os módulos do framework: `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- O ponto de referência Mazur 2-2-2: `post_update_loss.total = 0.29102777369359933` (em comparação com o valor amplamente citado de "downstream" 0.291027924 — desvio de ~1.5e-7; veja `fixtures/mazur.published.json` para o registro)
- Reconciliação por regra dentro de uma tolerância híbrida (`atol = 1e-12`, `rtol = 1e-9` para o motor; mais rigorosa onde a matemática é exata)

O que NÃO é contratual:

- Entre motores (Bun, Deno, navegadores) — diferentes implementações de `Math.exp`
- Entre versões principais do Node (24.x, 26.x, ...) — a porta V8 fdlibm pode ser revisada
- Pequenos incrementos arbitrários do V8 — ECMA-262 §21.3 deixa a precisão de `Math.exp` definida pela implementação
- Estabilidade de bits de valores que passam por `Math.exp` (sigmoid, tanh, softmax) em diferentes versões do V8

Um "canary" de `Math.exp(-0.5)` é executado em cada célula do CI como um alarme precoce para o desvio do fdlibm do V8. Uma falha significa "investigar o changelog do V8", não "bug no motor".

## O que não está nesta versão (ainda)

O `backprop-trace` v0.7.0 é um **produto em fase de desenvolvimento (mid-v0)**. O núcleo do motor, o reconciliador, o contrato de emissão canônica e o caminho de ingestão externa são reais e estáveis. No entanto, várias coisas que um verificador da versão 1.0 precisa ainda não estão presentes:

- **Receitas de observação em várias etapas.** A ingestão externa é de uma única etapa atualmente. As execuções de treinamento reais envolvem milhares de etapas. *Próximo objetivo: v0.8.*
- **Otimizadores além do SGD básico.** Sem Adam, AdamW, momentum ou decaimento de peso. O treinamento real de aprendizado de máquina em 2026 utiliza, em grande parte, o Adam; o uso exclusivo de SGD é uma limitação significativa. *Objetivo do roteiro: v0.9.*
- **Dimensão do lote.** Atualmente, apenas uma amostra. O treinamento real em PyTorch/JAX/TF utiliza lotes. Um usuário, ao tentar importar para sua etapa de treinamento real, precisa descompactar manualmente cada amostra. *Objetivo do roteiro: v0.9.*
- **Ferramentas de suporte para o ambiente de execução.** Atualmente, o componente auxiliar é criado manualmente; não há um pacote como `pip install backprop-trace-pytorch`, nem um script pronto para uso como `scripts/python-helpers/dump_pytorch_trace.py`. O caminho de "tenho uma etapa do PyTorch" para "tenho uma receita" é muito longo. *Objetivo do roteiro: v0.10.*
- **Exemplo prático do mundo real.** O exemplo pedagógico de Mazur 2-2-2 é o principal. Um verificador da versão 1.0 deve ter pelo menos uma arquitetura reconhecível (uma pequena CNN com forward e backward, um pequeno bloco transformer) como um exemplo integrado. *Objetivo do roteiro: v0.11.*
- **Validação pela comunidade.** Não há estudos de caso de pesquisadores externos, nenhum curso que adote isso para fins pedagógicos, nem nenhum engenheiro de conformidade que o tenha usado para um conjunto de auditoria. *Objetivo do roteiro: antes de qualquer promoção da versão 1.0.*
- **Determinismo da GPU.** Fora do escopo (e provavelmente permanecerá assim — as operações atômicas de convolução `cuDNN ConvolutionBackwardFilter` impedem a exatidão em nível de bit entre as execuções, [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). A posição do produto é: determinismo no ambiente de CPU.

Se o seu fluxo de trabalho depende de alguma dessas funcionalidades, esta não é a versão certa para você ainda.

## Criação de topologias personalizadas

Controle o motor a partir de uma configuração JSON — não são necessárias edições em TypeScript:

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulte [`docs/authoring.md`](./docs/authoring.md) para obter um guia passo a passo — esquemas de entrada versus esquemas de receita, a fronteira de confiança de emissão canônica.

## Onde isso se encaixa

- **Autores de artigos focados na reprodutibilidade** (submissões para NeurIPS/ICML/CoLLAs; pesquisadores conscientes do REFORMS — Kapoor et al., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — evidências deriváveis para cada etapa que o revisor pode executar em 30 segundos.
- **Pedagogia de aprendizado de máquina** (Karpathy zero-to-hero, cursos universitários de aprendizado profundo, preparação para entrevistas em sistemas de aprendizado de máquina) — uma única etapa de treinamento nomeada com todos os fatores visíveis e um reconciliador que *rejeita* exemplos defeituosos intencionalmente.
- **Engenheiros de frameworks/compiladores de aprendizado de máquina** (PyTorch / JAX / MLIR / XLA contributors) — gere um rastreamento conhecido e confiável para cada operação para testes diferenciais contra a saída de um novo compilador.
- **Engenheiros de conformidade/auditoria de aprendizado de máquina** (implementadores do Artigo 10 da Lei de IA da UE, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); consumidores de SLSA-for-ML) — um formato de receita para cada etapa, abaixo da assinatura de modelos, anexado a um cartão de modelo ou conjunto de auditoria.

## Referências:

- **Linha de descendência de "Proof-of-Learning" (Prova de Aprendizagem)** — Jia et al. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) para a ideia estrutural; Fang et al. (EuroS&P 2023) para a ressalva importante de que o PoL pode ser falsificado na prática. O "backprop-trace" se limita ao nível de verificação de CPU de um único passo, alcançável com determinismo.
- **REFORMS** — Kapoor et al. (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — Lista de verificação de reprodutibilidade de aprendizado de máquina com 32 itens; os mapas de evidências "receipt-style" para cada etapa correspondem aos itens 24 a 30.
- **Doutrina Csmith + CompCert** — Yang et al. (PLDI 2011) e Leroy (CACM 2009) — corpora adversariais comprovam um verificador; a "oracle" não deve consultar o artefato que está avaliando.
- **Atestado da cadeia de suprimentos** — in-toto v1, SLSA Provenance v1.0, modelo de transparência da Sigstore ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — os "receipts" do "backprop-trace" podem ser incluídos como sujeitos de uma declaração DSSE.

NÃO é zkML (sem sucintidade criptográfica). NÃO é opML (sem jogo de prova de fraude). NÃO é um logger de métricas de aprendizado de máquina — o backprop-trace escreve strings decimais em vez de floats binários; mais próximo de snapshots do Jest / Rust insta em espírito.

## A pilha de leis

De `docs/canonical-emission.md`:

> O contrato precede o motor. A política de formatação precede a formatação em tempo de execução. Os recibos inválidos precedem os recibos válidos. A formatação em tempo de execução precede o Mazur. O Mazur precede os diagnósticos.

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — Tutorial rápido de cinco minutos
- [`docs/cli.md`](./docs/cli.md) — Referência do subcomando `bp`
- [`docs/authoring.md`](./docs/authoring.md) — Como criar uma topologia personalizada
- [`docs/reconciliation.md`](./docs/reconciliation.md) — As 16 regras de reconciliação
- [`docs/topology.md`](./docs/topology.md) — Criação de topologias gerais
- [`docs/multi-step.md`](./docs/multi-step.md) — "Receipts" para treinamento em várias etapas (criados pelo "engine")
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrato de codificação em nível de byte
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordem IEEE 754; proibição de FMA; tolerância híbrida; limite de determinismo
- [`docs/schema.md`](./docs/schema.md) — Análise detalhada do esquema, campo por campo
- [`docs/attestation.md`](./docs/attestation.md) — Mecanismo de atestado in-toto v1
- `fixtures/` — Exemplos canônicos (Mazur, XOR, XOR por viés de neurônio, íris, softmax-CE, XOR em várias etapas), "sidecars" externos + exemplos em modo de observador (PyTorch, JAX, TensorFlow), "receipts" defeituosos intencionalmente (um para cada regra de reconciliação)
- `schemas/` — Esquemas receipt v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, topology-input v0.4.0, framework-trace v0.1.0 (todos fechados, anotados com "x-order", aditivos)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — A pilha de contribuições, o mecanismo anti-circularidade, a doutrina de "receipts" defeituosos antes dos "receipts" válidos.
- [`SECURITY.md`](./SECURITY.md) — O que conta como uma vulnerabilidade para um verificador
- [`CHANGELOG.md`](./CHANGELOG.md) — Histórico de versões

## Licença

MIT — veja `LICENSE`.
