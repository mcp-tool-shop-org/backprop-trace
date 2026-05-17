<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

# @mcptoolshop/backprop-trace

Motor de rastreamento determinístico para treinamento — gera registros JSONL canônicos de etapas individuais de retropropagação, verificados por um conciliador com 8 regras (todas as 8 regras implementadas na versão 0.2).

## Por que backprop-trace?

Se você ensina, audita ou verifica o treinamento de redes neurais, precisa de uma maneira de afirmar que "este rastreamento está correto". O backprop-trace gera registros canônicos de etapas individuais de retropropagação e um conciliador que recalcula todos os valores a partir dos fatores especificados. A versão 0.1 inclui o exemplo Mazur 2-2-2 — o exemplo mais citado de retropropagação para fins didáticos na web — como uma linha de base de regressão byte a byte, além de um exemplo defeituoso que prova que o verificador rejeita o que deveria rejeitar.

Isto **não** é um logger de métricas de aprendizado de máquina (use MLflow / W&B / TensorBoard para isso). É um verificador de rastreamento estrutural na linhagem de Proof-of-Learning (Jia et al. IEEE S&P 2021), focado em exemplos didáticos de etapas individuais — em uma escala de teste unitário, e não em uma execução completa de treinamento.

## Início rápido em 30 segundos

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

Para um guia mais detalhado, consulte [`docs/quickstart.md`](./docs/quickstart.md); para a referência da linha de comando, [`docs/cli.md`](./docs/cli.md); para o caminho de atestação, [`docs/attestation.md`](./docs/attestation.md).

## Instalação

```
pnpm add @mcptoolshop/backprop-trace
```

Ou com npm:

```
npm install @mcptoolshop/backprop-trace
```

## Uso da linha de comando

A versão 0.2 inclui quatro subcomandos. Referência completa: [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

Flags comuns (consulte [`docs/cli.md`](./docs/cli.md) para a referência completa):

- `--json` — saída JSON legível por máquina (para sistemas de integração contínua).
- `--verbose`, `-V` — mensagens de diagnóstico no stderr antes da execução.
- `--color=auto|never|always` — cor da saída; respeita a variável `NO_COLOR`.
- O argumento de arquivo `-` lê da entrada padrão ("reconciliar registro", "validar", "verificar mazur").

Códigos de saída: 0 (sucesso), 1 (falha na verificação), 2 (erro de E/S / entrada inválida), 3 (argumento inválido da linha de comando).

`bp --version` e `bp --help` funcionam sem um subcomando; `bp <subcomando> --help` mostra o uso específico do subcomando.

## Uso da biblioteca

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

Consulte [`docs/attestation.md`](./docs/attestation.md) para o mapeamento in-toto v1.

Importações de subdiretórios são exportadas (`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`).

## O que é isso

Um *verificador de rastreamento estrutural* com codificação canônica byte a byte. O registro é o contrato; o conciliador verifica cada afirmação feita pelo registro e verifica se a matemática está correta.

Referências:

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) para o princípio de que "receitas ruins precedem receitas boas".

NÃO é zkML (sem sucintidade criptográfica). NÃO é opML (sem jogo de prova de fraude). NÃO é um logger de métricas de aprendizado de máquina — o backprop-trace escreve strings decimais em vez de floats binários; mais próximo de snapshots do Jest / Rust insta em espírito.

## Escopo do determinismo

Fidelidade do rastreamento de 9 casas decimais dentro do envelope ULP do V8/Node 22. Os valores do motor fixos assumem doubles IEEE 754 escalares no V8.

A portabilidade entre motores (Hermes, JSC, Bun-JSC) **não é testada**. O valor de referência amplamente citado `0.291027924` difere do valor do motor `0.29102777369359933` em ~1,5e-7; consulte `fixtures/mazur.published.json` para o registro de desvio.

A versão 0.1 está fixada na versão Node 22.x.

## As oito regras

1. Consistência do sinal de erro de saída
2. Contribuição descendente e soma retropropagada
3. Consistência do sinal de erro oculto
4. Consistência do gradiente de atualização
5. Consistência do valor de atualização
6. Progressão dos pesos
7. Consistência do estado final
8. Consistência da referência de origem

Todas as 8 regras estão implementadas na versão 0.2 (a Regra 4 foi originalmente lançada na versão 0.1). As declarações completas das regras estão em [`docs/reconciliation.md`](./docs/reconciliation.md); cada regra é fornecida com um arquivo de teste `fixtures/bad/mazur.bad-<kind>.jsonl` intencionalmente corrompido, de acordo com a doutrina Csmith.

## A pilha de leis

De `docs/canonical-emission.md`:

> O contrato precede o motor. A política de formatação precede a formatação em tempo de execução. Os recibos inválidos precedem os recibos válidos. A formatação em tempo de execução precede o Mazur. O Mazur precede os diagnósticos.

## Escopo da versão 0.2

- Topologia Mazur 2-2-2 apenas
- Treinamento de etapa única apenas
- Apenas função de ativação sigmoide + função de perda de erro quadrático médio (MSE)
- Viés por camada
- Otimizador SGD (sem momento, sem Adam, sem decaimento de peso)
- Apenas CPU (sem alegações de determinismo da GPU)
- Apenas V8 / Node 22.x

Treinamento de várias etapas, topologia generalizada, funções de ativação/perda alternativas e otimizadores mais avançados são reservados para a versão 0.3+ (veja [`CHANGELOG.md`](./CHANGELOG.md) para saber o que foi incluído na versão 0.2).

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — tutorial rápido de cinco minutos
- [`docs/cli.md`](./docs/cli.md) — referência do subcomando `bp` (versão 0.2+)
- [`docs/reconciliation.md`](./docs/reconciliation.md) — as oito regras de reconciliação
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — contrato de codificação em nível de byte
- [`docs/computation-order.md`](./docs/computation-order.md) — regras de ordenação IEEE 754; proibição de FMA
- [`docs/schema.md`](./docs/schema.md) — análise detalhada de cada campo do esquema do recibo
- [`docs/attestation.md`](./docs/attestation.md) — mecanismo de atestado in-toto v1 (versão 0.2+)
- `fixtures/` — livro-razão canônico, política de formatação, oito recibos inválidos intencionalmente corrompidos (um para cada regra de reconciliação), derivados manualmente e publicados.
- `schemas/receipt.v0.1.0.json` — Esquema JSON do recibo (fechado, com anotações `x-order` que impulsionam a emissão canônica)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — a pilha de leis, o mecanismo anti-circularidade, a doutrina dos recibos inválidos que precedem os recibos válidos.
- [`SECURITY.md`](./SECURITY.md) — o que conta como uma vulnerabilidade para um verificador.

## Licença

MIT — veja `LICENSE`.
