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

Um verificador determinístico de 26 regras para as etapas de treinamento de redes neurais. Você fornece a ele um registro que lista todos os fatores que contribuíram para uma atualização de gradiente; o reconciliador recalcula todas as afirmações e rejeita em caso de divergência. Na linhagem Csmith/CompCert de *"o oráculo não deve consultar o artefato que está avaliando."*

> **v1.0.0 — Apenas CPU, determinístico.** O verificador cobre SGD · Adam · AdamW · SGD com momento (clássico / Nesterov / amortecimento) · **SGD com decaimento de peso L2 acoplado**, em 26 regras do reconciliador. Auxiliares **PyTorch e JAX** ativos extraem uma etapa real de treinamento para um registro verificável — apenas para observação, [Regra 14](./docs/reconciliation.md) é a autoridade sobre cada "sidecar" importado. 940 testes determinísticos; limites de tolerância definidos pelo verificador; mecanismo anti-circularidade. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) antes do uso em produção e o [CHANGELOG](./CHANGELOG.md) para o histórico de versões.

## Guia rápido de 30 segundos

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

O Mazur 2-2-2 é a demonstração passo a passo mais citada da retropropagação em uma única etapa na web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Cada número nele pode ser derivado manualmente.

## O que é isso

Um verificador de correção numérica para uma única etapa de treinamento. O reconciliador percorre 26 regras que recalculam cada afirmação a partir dos fatores especificados. Se alguma regra discordar dentro da tolerância híbrida (`atol + rtol`), o registro é rejeitado. As regras de várias etapas (9 + 10), em lote (18 + 19), as recorrências de momento do Adam (22-24), a recorrência de momento do SGD (20 + 21a/21b/21c + 25 + 26) e o recálculo diferencial do mecanismo nos rastreamentos importados da estrutura (Regra 14) abrangem as áreas relevantes para a produção.

Ele **não** valida toda a execução do treinamento, prova que o modelo está correto ou substitui um rastreador de experimentos. Ele prova que cada etapa registrada é matematicamente consistente e que a cadeia está intacta. Dados adversários comprovam um verificador ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — cada regra é fornecida com um "fixture" ruim correspondente em [`fixtures/bad/`](./fixtures/bad) que o verificador deve rejeitar *antes* de ler quaisquer metadados `fixture_status`.

## Auxiliar PyTorch ativo (v0.10+)

Arquivo Python único e auditável. Sem pacote pip por design — copie-o para o seu repositório, leia-o, execute-o.

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

O auxiliar emite um "sidecar" `framework-trace.v0.7.0` com um bloco forense `helper` (nome, versão, hash da fonte, versão da estrutura, tempo de execução, carimbo de data/hora da extração). O bloco **não é uma credencial** — a Regra 14 (recálculo diferencial do mecanismo) é a autoridade sobre cada "sidecar" emitido pelo auxiliar, independentemente do que o auxiliar afirme. Um `source_hash` falsificado/incorreto/ausente NÃO ignora a Regra 14. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) para a declaração de limite de confiança, a lista proibida, o catálogo adversarial com 9 "fixtures" e o contrato de não distribuição via pip.

**Suportado**: PyTorch SGD + Adam + AdamW + sgd_momentum (clássico/Nesterov/amortecimento) + **SGD com decaimento de peso L2 acoplado**, com a inversão do sinal `momentum_buffer` de ascensão para descida, conforme [problema do PyTorch #1099](https://github.com/pytorch/pytorch/issues/1099). Prioridade para CPU. Etapa única + várias etapas. Um auxiliar **JAX ativo paralelo** (`scripts/extract/jax.py`) cobre SGD + Adam com um limite de confiança mais forte — ele inclui um resumo de `jax.make_jaxpr(jax.grad(loss))` no bloco forense (o grafo de gradiente inspecionável que o PyTorch "eager" não possui) e se recusa a executar sem `jax_enable_x64` + CPU. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md).
**Rejeitado no limite**: AMP/autocast, CUDA/MPS/XLA, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologias de várias camadas ocultas. "Sidecars" criados manualmente para essas estruturas/otimizadores continuam a funcionar por meio do caminho padrão `bp import`.

## O que isso não é

- **Não é um rastreador de experimentos.** Use [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) — eles registram as afirmações; a retropropagação recalcula se a matemática é internamente consistente.
- **Não é Proof-of-Learning ou zkML.** [PoL](https://arxiv.org/abs/2103.05633) foi demonstrado como falsificável em treinamentos reais ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produz provas criptográficas. A retropropagação não é criptográfica, é de etapa única e o público é um humano ou revisor de CI.
- **Não é atestação da cadeia de suprimentos.** [Assinatura de modelo Sigstore](https://github.com/sigstore/model-transparency), [SLSA para modelos](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) atestam a proveniência do pipeline; a retropropagação atesta a consistência numérica. Um ML-BOM pode referenciar um registro de retropropagação como um predicado de consistência interna.

## Modelo de ameaças

Em escopo: qualquer registro que deva ser rejeitado, mas é aceito — desvio do esquema, envenenamento com NaN/Infinito, divergência na emissão canônica, violações da anti-circularidade, discordância no recálculo do mecanismo em "sidecars" importados. Fora de escopo: confiabilidade da execução do treinamento em si, ataques de canal lateral ao processo do verificador. O determinismo é limitado: a saída idêntica em bytes é garantida apenas entre a mesma versão da retropropagação, Node.js 22.x e a mesma especificação de emissão canônica. Consulte [SECURITY.md](./SECURITY.md) para a enumeração completa + cronograma de divulgação.

## Instalação

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fixado no Node 22.x (o determinismo do V8 fdlibm `Math.exp` é fundamental — consulte [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI

Referência completa: [`docs/cli.md`](./docs/cli.md).

| Verbo | Propósito |
|---|---|
| `bp reconcile receipt <file>` | Executar todas as 26 regras; sair com código 1 na primeira falha |
| `bp verify mazur` | Teste completo no "fixture" incluído de Mazur. |
| `bp verify general <file>` | Gate generalizado (v0.2+; resultados: XOR, iris, softmax+CE, modo observador) |
| `bp verify multi <file.jsonl>` | JSONL com vários registros + regras entre registros (9/10) |
| `bp generate {mazur,xor,iris}` | Execute novamente o motor especificado e gere bytes canônicos |
| `bp generate from-config <file>` | Execute o motor novamente a partir de uma topologia e um arquivo JSON de entrada |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | Crie um arquivo de configuração de entrada inicial |
| `bp validate-input <file>` | Valide o esquema de uma topologia e um arquivo de configuração de entrada |
| `bp validate <file>` | Valide o esquema de um resultado (detecta automaticamente v0.1-v0.7) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Ingira rastreamento de um framework externo |
| `bp examples {pytorch,jax} [--print]` | Imprima o caminho (ou exiba o conteúdo) do auxiliar PyTorch/JAX ativo incluído |

Flags comuns: `--out <arquivo>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, argumento de arquivo `-` = stdin. Códigos de saída: `0` (sucesso) · `1` (falha na verificação) · `2` (uso/E-S) · `3` (argumento inválido da CLI) · `4` (framework não implementado).

## Biblioteca

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

> **Qual gate comprova o quê.** `reconcileReceipt` comprova que a matemática do resultado é
> *internamente consistente* (as 26 regras derivam novamente cada afirmação dos próprios fatores do resultado). Para um resultado de **origem desconhecida**, combine-o com o gate `engine-reproduce` — `verifyEngineReproduces` (ou `bp verify general`), que executa novamente o motor determinístico a partir das entradas do resultado e compara campo por campo. Esse segundo gate é o que fecha o ciclo anti-circularidade: a consistência interna sozinha não consegue detectar um resultado externo que tenha sido rotulado como sendo de autoria do motor, porque nenhuma regra específica para cada resultado deriva novamente o passo direto para um resultado de autoria do motor. As importações no modo observador (`importPytorchSidecar`) executam automaticamente a análise diferencial `engine-reproduce` (Regra 14); `bp verify` sempre executa os dois gates.

Importações de subcaminho: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, mais a família de esquemas `./schema/...`.

## As 26 regras

Declarações completas + casos de teste adversários: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regra |
|---|---|
| 0 | Sentinela de falha estrutural (nível de esquema) |
| 0.8 | Limites de probabilidade — saídas softmax em [0, 1] |
| 1-4 | Sinais de erro (saída, downstream, oculto) + consistência do gradiente de atualização |
| 5-7 | Valor de atualização, progressão de peso, estado final (ramificação AdamW nas Regras 6/7 para decaimento de peso desacoplado) |
| 8 | Consistência da referência de proveniência |
| 9-10 | Cadeia de parâmetros em várias etapas + identidade do rastreamento |
| 11-13 | Normalização softmax + fórmula de perda + forma dupla (GATED) |
| 14 | Análise diferencial de recomputação do motor (OBRIGATÓRIO nas importações no modo observador) |
| 15-17 | Vinculação de base de salto + vinculação de resumo assinado + vinculação de raiz do pacote (GATED) |
| 18-19 | Consistência da redução em lote + coerência do conjunto de amostras (GATED) |
| 20 | Forma do estado do otimizador (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **Momentum SGD no estilo PyTorch**: 21a recorrência do buffer + 21b direção efetiva + 21c atualização de parâmetro |
| 22-24 | Recorrências de momento Adam + correção de viés + atualização de parâmetro (épsilon FORA da raiz quadrada) |
| 25-26 | Cadeia do estado do otimizador em várias etapas + constância da configuração do otimizador |

## Escopo de determinismo

Contratual no Nó 22.x × {ubuntu, macos, windows} × rastreamento de retropropagação 0.12.x: valores de referência idênticos em bytes (Mazur, XOR, iris, softmax+CE, várias etapas, em lote, sidecars externos); o ponto de ancoragem Mazur `post_update_loss.total = 0.29102777369359933`; reconciliação por regra dentro de `atol=1e-12`, `rtol=1e-9` para resultados de autoria do motor.

NÃO contratual: entre motores (Bun, Deno, navegadores); entre nós principais diferentes (24.x+); alterações arbitrárias da versão secundária do V8. Um "canário" `Math.exp(-0.5)` é acionado em cada célula de CI como um alarme de desvio do fdlibm do V8.

## O que não está nesta versão (ainda)

A v1.0.0 cobre o caso extremo determinístico da CPU de ponta a ponta: o motor, o reconciliador, o contrato de emissão canônica, o caminho de ingestão externo, os auxiliares PyTorch **e** JAX ativos, os otimizadores da família SGD, incluindo o decaimento do peso L2 acoplado, um caso de teste "herói" reconhecível e um [pacote de conformidade] trabalhado (./docs/compliance.md). O roteiro abaixo é o que **não está deliberadamente coberto ainda** — ordenado por uso × viabilidade de verificação, cada um dependente de uma recomputação em forma fechada da CPU que o reconciliador realmente possa controlar:

- **NAdam (+ opcionalmente RAdam)** – variantes mais econômicas do Adam. Em seguida, a **verificação da programação da taxa de aprendizado**, que se combina com cada otimizador. *Próximo.*
- **AMSGrad / normalização global do gradiente / taxas de aprendizado por grupo / Lion** – cada um ativado por meio de uma extensão de recibo/reconciliador. *Mais tarde.*
- **Topologias Conv / multi-camada oculta** – o motor é uma camada densa única; o principal componente é um classificador denso e reconhecível ReLU→softmax. Conv traz a ordenação FP de kernel fundido que combate o determinismo de bits (veja a GPU abaixo). *Provavelmente fora do escopo de determinação na CPU.*
- **Rastreamentos multi-framework heterogêneos** – apenas pacotes de framework único; fluxos de framework misto não são suportados. *Pode permanecer fora do escopo.*
- **Tamanhos de lote heterogêneos em diferentes etapas** – tamanho_lote fixo por fluxo. *Pode permanecer fora do escopo.*
- **Gradientes por amostra em recibos agrupados** – apenas gradientes reduzidos hoje; a decomposição por amostra é útil para auditorias de influência, mas ainda não está disponível. *Mais tarde.*
- **Vinculação da identidade do produtor em rastreamentos multi-etapa** – A Regra 17 detecta falhas na integridade do pacote, e não a autenticidade do produtor. Combine com a Regra 16 / Sigstore / atestado fora de banda. Superfície do operador, não um recurso integrado.
- **GPU / determinismo de bits de kernel fundido** – fora do escopo e permanente. A não associatividade de ponto flutuante torna o determinismo exato inatingível em kernels fundidos/paralelos ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148); operações atômicas cuDNN ConvolutionBackwardFilter por [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). O resultado é o escopo de determinação na CPU.

Se seu fluxo de trabalho depender de algum desses, esta não é a versão certa para você ainda.

## Crie uma topologia personalizada

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Veja [`docs/authoring.md`](./docs/authoring.md) – esquemas de entrada versus recibo, limite de confiança da emissão canônica.

## Onde isso se encaixa

- **Autores de artigos com foco na reprodutibilidade** (NeurIPS/ICML/CoLLAs; conscientes do [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) – evidências por etapa que podem ser rederivadas e que o revisor executa em 30 segundos.
- **Pedagogia de ML** (Karpathy do zero ao herói, cursos universitários de DL, preparação para entrevistas) – uma única etapa de treinamento nomeada com todos os fatores visíveis e um reconciliador que *rejeita* componentes deliberadamente defeituosos.
- **Engenheiros de framework / compiladores de ML** (colaboradores do PyTorch / JAX / MLIR / XLA) – rastreamento por operação conhecido para testes diferenciais.
- **Engenheiros de conformidade / auditoria de ML** ([Anexo IV §2(g) da Lei de IA da UE, logs de validação/teste + Artigo 15 sobre robustez](https://artificialintelligenceact.eu/annex/4/); SLSA para ML) – um recibo por etapa como um registro de teste verificável, datado e assinável abaixo da assinatura do modelo. Veja o pacote de conformidade trabalhado em `./docs/compliance.md` (e o escopo honesto: os recibos atestam *matemática*, não a governança de dados).

## A pilha de leis

De `docs/canonical-emission.md`:

> O contrato precede o motor. A política do formatador precede a formatação em tempo de execução. Recibos ruins precedem recibos bons. A formatação em tempo de execução precede Mazur. Mazur precede os diagnósticos.

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) – demonstração de cinco minutos
- [`docs/cli.md`](./docs/cli.md) – referência do subcomando `bp`
- [`docs/live-helpers.md`](./docs/live-helpers.md) – auxiliar PyTorch v0.10 em tempo real: fluxo de trabalho, limite de confiança, catálogo adversarial, justificativa para não usar pip
- [`docs/authoring.md`](./docs/authoring.md) – crie uma topologia personalizada
- [`docs/reconciliation.md`](./docs/reconciliation.md) – as 26 regras do reconciliador em detalhes
- [`docs/topology.md`](./docs/topology.md) – criação de topologias gerais
- [`docs/multi-step.md`](./docs/multi-step.md) – recibos de treinamento multi-etapa
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) – contrato de codificação em nível de byte
- [`docs/computation-order.md`](./docs/computation-order.md) – ordenação IEEE 754; proibição de FMA; limite de determinismo
- [`docs/schema.md`](./docs/schema.md) – análise do esquema campo por campo
- [`docs/attestation.md`](./docs/attestation.md) – ponto de atestado v1 in-toto
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) – mecanismo anti-circularidade; doutrina dos recibos ruins precedendo os bons
- [`SECURITY.md`](./SECURITY.md) – o que conta como uma vulnerabilidade para um verificador
- [`CHANGELOG.md`](./CHANGELOG.md) – histórico por versão

## Licença

MIT – veja [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
