<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

# @mcptoolshop/backprop-trace

Motor de trazabilidad determinista para el entrenamiento: genera registros JSONL canónicos de cada paso de retropropagación, verificados por un conciliador con 8 reglas (todas las 8 reglas implementadas en la versión 0.2).

## ¿Por qué usar backprop-trace?

Si enseña, audita o verifica el entrenamiento de redes neuronales, necesita una forma de decir "esta trazabilidad es correcta". backprop-trace genera registros canónicos de cada paso de retropropagación y un conciliador que vuelve a derivar cada valor a partir de los factores especificados. La versión 0.1 incluye el ejemplo de Mazur 2-2-2, el ejemplo de retropropagación más citado en la web, como una línea de base de regresión de igualdad de bytes, además de un ejemplo incorrecto que demuestra que el verificador rechaza lo que debería rechazar.

Esto **no** es un registrador de métricas de aprendizaje automático (use MLflow / W&B / TensorBoard para eso). Es un verificador de trazabilidad estructural dentro de la línea de Proof-of-Learning (Jia et al. IEEE S&P 2021), enfocado en ejemplos de un solo paso con fines educativos, a escala de pruebas unitarias, en lugar de a escala de una ejecución completa de entrenamiento.

## Guía rápida de 30 segundos

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

Para una guía más detallada, consulte [`docs/quickstart.md`](./docs/quickstart.md); para la referencia de la línea de comandos, [`docs/cli.md`](./docs/cli.md); para la información sobre la certificación, [`docs/attestation.md`](./docs/attestation.md).

## Instalación

```
pnpm add @mcptoolshop/backprop-trace
```

O con npm:

```
npm install @mcptoolshop/backprop-trace
```

## Uso de la línea de comandos

La versión 0.2 incluye cuatro subcomandos. Consulte la referencia completa en [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

Opciones comunes (consulte [`docs/cli.md`](./docs/cli.md) para la referencia completa):

- `--json` — salida JSON legible por máquinas (para sistemas de integración continua).
- `--verbose`, `-V` — mensajes de diagnóstico en la salida de error estándar antes de la ejecución.
- `--color=auto|never|always` — color en la salida; respeta la variable de entorno `NO_COLOR`.
- El argumento de archivo `-` lee desde la entrada estándar (`conciliar registro`, `validar`, `verificar mazur`).

Códigos de salida: 0 (éxito), 1 (fallo en la verificación), 2 (error de E/S / entrada incorrecta), 3 (argumento incorrecto en la línea de comandos).

`bp --version` y `bp --help` funcionan sin un subcomando; `bp <subcomando> --help` muestra el uso específico del subcomando.

## Uso de la biblioteca

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

Consulte [`docs/attestation.md`](./docs/attestation.md) para la correspondencia con in-toto v1.

Las importaciones de subdirectorios se exportan (`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`).

## ¿Qué es esto?

Un *verificador de trazabilidad estructural* con codificación canónica de bytes. El registro es el contrato; el conciliador verifica cada afirmación que hace el registro y comprueba que las operaciones matemáticas sean correctas.

Referencias:

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) para el principio de que los registros incorrectos preceden a los correctos.

NO es zkML (no tiene concisión criptográfica). NO es opML (no tiene un juego de prueba de fraude). NO es un registrador de métricas de aprendizaje automático; backprop-trace escribe cadenas decimales en lugar de números de punto flotante binarios; es más similar a Jest snapshots / Rust insta en espíritu.

## Alcance del determinismo

Fidelidad de la trazabilidad de 9 dígitos significativos dentro del rango ULP de V8/Node 22. Los valores del motor fijos asumen dobles IEEE 754 escalares en V8.

La portabilidad entre motores (Hermes, JSC, Bun-JSC) **no se ha probado**. El valor de referencia ampliamente citado `0.291027924` difiere del valor del motor `0.29102777369359933` en aproximadamente 1.5e-7; consulte `fixtures/mazur.published.json` para el registro de la desviación.

La versión 0.1 está fijada a Node 22.x.

## Las ocho reglas

1. Consistencia de la señal de error de salida.
2. Contribución descendente y suma retropropagada.
3. Consistencia de la señal de error oculta.
4. Consistencia del gradiente de actualización.
5. Consistencia del valor de actualización.
6. Progresión de los pesos.
7. Consistencia del estado final.
8. Consistencia de la referencia de origen.

Las 8 reglas están implementadas en la versión 0.2 (la regla 4 se incluyó originalmente en la versión 0.1). Las declaraciones completas de cada regla se encuentran en [`docs/reconciliation.md`](./docs/reconciliation.md); cada regla se proporciona con un archivo de prueba "defectuoso" `fixtures/bad/mazur.bad-<kind>.jsonl`, siguiendo la doctrina de Csmith.

## La pila de leyes

Extraído de `docs/canonical-emission.md`:

> El contrato precede al motor. La política de formato precede al formato en tiempo de ejecución. Los recibos incorrectos preceden a los recibos correctos. El formato en tiempo de ejecución precede a Mazur. Mazur precede a los diagnósticos.

## Alcance de la versión 0.2

- Topología Mazur 2-2-2 únicamente.
- Solo entrenamiento de un solo paso.
- Solo función de activación sigmoide y función de pérdida de error cuadrático medio (MSE).
- Sesgos por capa.
- Optimizador SGD (sin momento, sin Adam, sin decaimiento de peso).
- Solo CPU (sin afirmaciones de determinismo de GPU).
- Solo V8 / Node 22.x.

El entrenamiento de varios pasos, la topología generalizada, las funciones de activación/pérdida alternativas y los optimizadores más avanzados están reservados para la versión 0.3 o posterior (consulte [`CHANGELOG.md`](./CHANGELOG.md) para ver qué se incluyó en la versión 0.2).

## Enlaces

- [`docs/quickstart.md`](./docs/quickstart.md) — Guía rápida de cinco minutos.
- [`docs/cli.md`](./docs/cli.md) — Referencia del subcomando `bp` (versión 0.2+).
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Las ocho reglas de conciliación.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrato de codificación a nivel de bytes.
- [`docs/computation-order.md`](./docs/computation-order.md) — Reglas de ordenamiento IEEE 754; prohibición de FMA.
- [`docs/schema.md`](./docs/schema.md) — Descripción detallada de cada campo del esquema del recibo.
- [`docs/attestation.md`](./docs/attestation.md) — Mecanismo de certificación in-toto v1 (versión 0.2+).
- `fixtures/` — Registro canónico y de referencia, política de formato, ocho recibos "incorrectos" deliberadamente creados (uno por cada regla de conciliación).
- `schemas/receipt.v0.1.0.json` — Esquema JSON del recibo (cerrado, con anotaciones `x-order` que controlan la emisión canónica).
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — La pila de leyes, el mecanismo antirretroceso, la doctrina de que los recibos incorrectos preceden a los correctos.
- [`SECURITY.md`](./SECURITY.md) — Qué se considera una vulnerabilidad para un verificador.

## Licencia

MIT — consulte `LICENSE`.
