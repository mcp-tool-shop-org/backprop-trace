<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

Un verificador estructural determinista de trazabilidad para pasos individuales de entrenamiento de redes neuronales: un reconcilador de 16 reglas que vuelve a derivar gradientes, señales y actualizaciones de parámetros a partir de factores nombrados, y genera registros JSONL canónicos en formato de bytes. En la línea de Csmith/CompCert, que sigue el principio de *"el oráculo no debe consultar el artefacto que está juzgando"*.

> **Estado: versión preliminar v0 (v0.7.0).** El motor principal y el reconcilador son funcionales y están disponibles. Funciona con un solo paso, solo en CPU, solo con SGD y con una sola muestra. Actualmente, los rastros de marcos externos se generan manualmente como archivos complementarios. Consulte [Qué no está incluido en esta versión (todavía)](#whats-not-in-this-version-yet) antes de utilizarlo en entornos de producción.

## Guía de inicio rápido de 30 segundos

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

El ejemplo Mazur 2-2-2 es la explicación paso a paso de la retropropagación más citada en la web (Matt Mazur, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Es un ejemplo fundamental porque cada número en él puede derivarse manualmente. Para su propio rastreo, consulte [Proporcione su propio rastreo de entrenamiento](#bring-your-own-training-trace).

## ¿Qué es esto?

backprop-trace es un verificador de corrección numérica para *un solo* paso de entrenamiento de una red neuronal. Le proporciona un registro: un registro JSONL que nombra cada factor que contribuyó a una sola actualización de gradiente, y el reconcilador aplica 16 reglas para volver a derivar cada afirmación a partir de los factores nombrados. Si alguna regla no coincide dentro de una tolerancia híbrida (`atol + rtol`, forma máxima simétrica), el registro se rechaza.

El principio fundamental es Csmith (Yang, Chen, Eide, Regehr — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) y CompCert (Leroy, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)): los conjuntos de datos adversarios prueban un verificador, y las pruebas que pasan no lo hacen. Cada regla del reconcilador se proporciona con un ejemplo deliberadamente incorrecto en el directorio [`fixtures/bad/`](./fixtures/bad/) que el verificador debe rechazar *antes* de leer cualquier metadato del ciclo de vida `fixture_status`. Esta disciplina de anti-circularidad —el oráculo no debe consultar el artefacto que está juzgando— es la propiedad fundamental.

## ¿Qué *no* es esto?

- **No es un rastreador de experimentos.** Si desea curvas de pérdida, paneles de control o almacenamiento de ejecuciones a largo plazo, utilice [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai) o [TensorBoard](https://www.tensorflow.org/tensorboard). Estos registran lo que el entrenador afirma que sucedió. backprop-trace vuelve a derivar si las matemáticas son internamente consistentes. Son complementarios, no superpuestos.
- **No es una prueba de aprendizaje (Proof-of-Learning) ni zkML.** Se ha demostrado que la línea de PoL (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) puede ser falsificada en entrenamientos reales (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)). zkML/opML (EZKL, Modulus, ORA) produce pruebas criptográficas o respaldadas económicamente para la liquidación segura en la cadena de bloques. backprop-trace no es criptográfico, funciona con un solo paso y está diseñado para ser revisado por humanos o por revisores de CI.
- **No es una certificación de la cadena de suministro.** [La firma de modelos de Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev) y [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) certifican que *el artefacto X fue producido por la canalización Y*. backprop-trace certifica que *esta actualización se puede derivar matemáticamente de estos factores*. Son complementarios: un ML-BOM puede hacer referencia a un registro de backprop-trace como un predicado de consistencia interna.

## Modelo de amenazas

backprop-trace es un verificador determinista: su alcance incluye cualquier recibo que debería ser rechazado pero que es aceptado, como elusión del esquema, inyección de NaN/Infinito, divergencia de la emisión canónica, violaciones de anti-circularidad (el conciliador consulta `fixture_status` antes de completar las comprobaciones de reglas) y desacuerdos en el re-cálculo del motor sobre los rastros de frameworks importados. Queda fuera de su alcance la confiabilidad de la ejecución de entrenamiento en sí, la corrección del modelo que se está entrenando, los ataques de canal lateral o de temporización contra el proceso de verificación, y cualquier cosa que vaya más allá de la decisión de aceptación del recibo. El determinismo está limitado: la salida idéntica en bytes está garantizada solo dentro de la misma versión de backprop-trace, la misma versión principal de Node.js (actualmente 22.x) y la misma versión de especificación de emisión canónica. La reproducción entre motores (Hermes, JSC, Bun-JSC) y entre versiones principales de Node.js (24.x, 26.x, ...) no es un objetivo. El verificador confía en el formato del recibo y en el contrato de emisión canónica; no confía en el productor. Consulte [SECURITY.md](./SECURITY.md) para obtener el cronograma de divulgación, la rúbrica de gravedad y la enumeración completa.

## Instalación

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Vinculado a Node 22.x (el determinismo de `Math.exp` de V8 fdlibm es crucial; consulte [`docs/computation-order.md`](./docs/computation-order.md)).

## Uso de la línea de comandos

v0.7 incluye 16 subcomandos. Referencia completa: [`docs/cli.md`](./docs/cli.md).

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

Marcas comunes (consulte [`docs/cli.md`](./docs/cli.md)):

- `--out <file>`: escribe en un archivo en lugar de stdout.
- `--json`: salida JSON legible por máquinas (para consumidores de CI).
- `--verbose`, `-V`: mensajes de diagnóstico en stderr antes de la ejecución.
- `--color=auto|never|always`: color de la salida; respeta `NO_COLOR`.
- El argumento de archivo `-` lee desde stdin (`reconcile receipt`, `validate`, `verify general`).

Códigos de salida: `0` éxito · `1` fallo de verificación · `2` error de uso o E/S · `3` argumento de la línea de comandos inválido · `4` framework no implementado.

## Uso de la biblioteca

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

Importaciones de subrutas: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (topology-input), `./schema/framework-trace-0.1.0`.

## Proporcione su propio rastreo de entrenamiento

La ruta de ingestión externa de v0.6 permite a los usuarios de PyTorch / JAX / TensorFlow verificar sus propios rastros de backprop de un solo paso contra las mismas 16 reglas, pero **hoy en día el archivo adjunto se crea manualmente**. Todavía no existe el helper `pip install backprop-trace-pytorch`. Para crear un archivo adjunto:

1. Lea el esquema [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json): define un contrato JSONL para un paso de entrenamiento (topología + entrada + propagación directa + gradientes + parámetros_antes + parámetros_después + procedencia).
2. Extraiga esos valores de su paso de entrenamiento (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape`: todos exponen la información numérica necesaria para cada tensor).
3. Genere el archivo adjunto como JSONL canónico (cadenas decimales, no números de punto flotante binarios; consulte [`docs/canonical-emission.md`](./docs/canonical-emission.md)).
4. Ejecute `bp import pytorch <sidecar.jsonl>` (o `import jax` / `import tensorflow`).
5. El importador produce un **recibo en modo de observador**: las afirmaciones del framework se almacenan como campos canónicos; el motor de backprop-trace recalcula el mismo paso y ejecuta la **Regla 14** como una verificación diferencial. La discrepancia indica que su extractor mintió, o que su framework ha cambiado, o que hay algo mal con el rastreo.

Este es un flujo de trabajo real hoy en día, pero es complejo. Consulte [Lo que no está en esta versión (todavía)](#whats-not-in-this-version-yet) para obtener información sobre la falta de un helper de empaquetado.

Se aplica la disciplina de subcomandos específicos para cada framework: `bp import pytorch` rechaza los componentes auxiliares de JAX y viceversa. No hay detección automática (no hay dependencia de tiempo de ejecución del framework en este paquete, por diseño).

## Las 16 reglas

| # | Regla |
|---|---|
| 0 | Indicador de fallo estructural (a nivel de esquema) |
| 0.8 | Límites de probabilidad: las salidas de softmax deben estar en el rango [0, 1] |
| 1 | Consistencia de la señal de error de salida |
| 2 | Contribución descendente y suma de retropropagación |
| 3 | Consistencia de la señal de error oculta |
| 4 | Consistencia de la actualización del gradiente |
| 5 | Consistencia del valor de la actualización |
| 6 | Progresión de los pesos |
| 7 | Consistencia del estado final |
| 8 | Consistencia de la referencia de origen |
| 9 | Cadena de parámetros de múltiples pasos (`parameters_before[N]` = valor anterior `parameters_after[N-1]`) |
| 10 | Identidad de la traza de múltiples pasos (ID de traza `trace_id` compartido + índice de paso `step_index` secuencial) |
| 11 | Normalización de softmax (`sum(forward[output].out) == 1.0`) |
| 12 | Consistencia de la fórmula de la pérdida (rama de error cuadrático medio + rama de entropía cruzada softmax) |
| 13 | Consistencia de la forma dual (descomposición jacobiana de softmax + entropía cruzada; ACTIVADO solo cuando `dual_form` está presente) |
| 14 | Diferencial de recomputación del motor (OBLIGATORIO para los registros importados en modo de observador) |
| 15 | Base de omisión requerida (enum cerrado `EXTERNAL_TRUST_BASIS`, 4 valores) |
| 16 | Enlace de la huella de certificación (ACTIVADO cuando `attestor.signed_subject_digest` está presente) |

Declaraciones completas en [`docs/reconciliation.md`](./docs/reconciliation.md). Cada regla viene con un conjunto de pruebas incorrectas correspondientes en `fixtures/bad/`, siguiendo la doctrina de Csmith.

## Ámbito del determinismo

Lo que es contractual en la matriz fija (Node 22.x × {ubuntu, macos, windows} × traza de retropropagación 0.7.x):

- Igual byte a byte: `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl`
- Huellas doradas externas para los componentes auxiliares del framework incluidos: `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- El ancla Mazur 2-2-2: `post_update_loss.total = 0.29102777369359933` (en comparación con el valor ampliamente citado de la salida descendente `0.291027924` — desviación de ~1.5e-7; consulte `fixtures/mazur.published.json` para el registro)
- Consistencia por regla dentro de una tolerancia híbrida (`atol = 1e-12`, `rtol = 1e-9` para los valores generados por el motor; más ajustada donde la matemática es exacta)

Lo que NO es contractual:

- Entre motores (Bun, Deno, navegadores) — diferentes implementaciones de `Math.exp`
- Entre versiones principales de Node (24.x, 26.x, ...) — el puerto V8 fdlibm puede ser revisado
- Cambios menores arbitrarios de V8 — ECMA-262 §21.3 deja la precisión de `Math.exp` definida por la implementación
- Estabilidad de bits de los valores que fluyen a través de `Math.exp` (sigmoide, tangente hiperbólica, softmax) en diferentes versiones de V8

Una prueba `Math.exp(-0.5)` se ejecuta en cada celda de CI como una señal de advertencia temprana para la deriva de V8 fdlibm. Un fallo significa "investigar el registro de cambios de V8", no "error del motor".

## Lo que no está en esta versión (todavía)

`backprop-trace` v0.7.0 es un **producto en fase de desarrollo (mid-v0)**. El motor central, el conciliador, el contrato de emisión canónica y la ruta de ingesta externa son reales y estables. Sin embargo, varias cosas que un verificador de la versión 1.0 necesita aún no están incluidas:

- **Recibos con múltiples pasos en modo de observación.** La ingestión externa es de un solo paso actualmente. Las ejecuciones de entrenamiento reales tienen miles de pasos. *Objetivo para la versión 0.8.*
- **Optimizadores más allá del SGD básico.** No incluye Adam, AdamW, momentum ni decaimiento de peso. El entrenamiento real de aprendizaje automático en 2026 utiliza abrumadoramente Adam; el uso exclusivo de SGD es una limitación importante. *Objetivo del plan de desarrollo: versión 0.9.*
- **Dimensión del lote.** Actualmente, un solo ejemplo. El entrenamiento real en PyTorch/JAX/TF utiliza lotes. Un usuario con su propio paso de entrenamiento no puede importarlo sin "desenrollar" manualmente cada ejemplo. *Objetivo del plan de desarrollo: versión 0.9.*
- **Herramientas de soporte para el entorno de ejecución.** Actualmente, el componente adicional se crea manualmente; no hay un paquete como `pip install backprop-trace-pytorch`, ni un extractor listo para usar como `scripts/python-helpers/dump_pytorch_trace.py`. El camino desde "tengo un paso de PyTorch" hasta "tengo un recibo" es demasiado largo. *Objetivo del plan de desarrollo: versión 0.10.*
- **Entorno de prueba realista.** El ejemplo pedagógico de Mazur 2-2-2 es el elemento central. Un verificador de la versión 1.0 debería tener al menos una arquitectura reconocible (una pequeña CNN con propagación hacia adelante y hacia atrás, un pequeño bloque de transformador) como un entorno de prueba integrado. *Objetivo del plan de desarrollo: versión 0.11.*
- **Validación por parte de los usuarios.** No hay estudios de caso de investigadores externos, ni cursos que lo adopten para fines pedagógicos, ni ingenieros de cumplimiento que lo hayan utilizado para un paquete de auditoría. *Objetivo del plan de desarrollo: antes de cualquier promoción de la versión 1.0.*
- **Determinismo de la GPU.** Fuera del alcance (y probablemente lo seguirá siendo; las operaciones atómicas de cuDNN ConvolutionBackwardFilter impiden la exactitud de bits entre ejecuciones [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La posición del producto es: determinismo en la esquina de la CPU.

Si su flujo de trabajo depende de alguno de estos elementos, esta no es la versión adecuada para usted todavía.

## Creación de topologías personalizadas

Controle el motor a partir de una configuración JSON; no se requieren modificaciones en TypeScript:

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulte [`docs/authoring.md`](./docs/authoring.md) para obtener una guía paso a paso: esquemas de entrada y de recibo, el límite de confianza de emisión canónica.

## Para qué sirve esto

- **Autores de artículos centrados en la reproducibilidad** (autores que presentan trabajos en NeurIPS/ICML/CoLLAs; investigadores conscientes de REFORMS — Kapoor et al., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — evidencia derivable por cada paso que el revisor puede ejecutar en 30 segundos.
- **Pedagogía de aprendizaje automático** (Karpathy de cero a héroe, cursos universitarios de aprendizaje profundo, preparación para entrevistas de sistemas de aprendizaje automático) — un solo paso de entrenamiento con todos los factores visibles y un conciliador que *rechaza* entornos de prueba deliberadamente incorrectos.
- **Ingenieros de marcos de trabajo/compiladores de aprendizaje automático** (PyTorch / JAX / MLIR / XLA contributors) — genera un rastro conocido y correcto para cada operación para realizar pruebas diferenciales contra la salida de un nuevo compilador.
- **Ingenieros de cumplimiento/auditoría de aprendizaje automático** (implementadores del Artículo 10 de la Ley de IA de la UE, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); consumidores de SLSA-for-ML) — un formato de recibo por cada paso, inferior a la firma del modelo, adjunto a una tarjeta de modelo o a un paquete de auditoría.

## Clase de referencia

- **Línea de descendencia de "Proof-of-Learning" (PoL)**: Jia et al. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) para la idea estructural; Fang et al. (EuroS&P 2023) para la advertencia importante de que PoL es susceptible de ser falsificado en la práctica.  `backprop-trace` se limita a la verificación de la CPU de un solo paso, que es lo que se puede lograr con determinismo.
- **REFORMS**: Kapoor et al. (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — Lista de verificación de reproducibilidad de aprendizaje automático con 32 elementos; los "recibos" de evidencia paso a paso se mapean a los elementos 24-30.
- **Doctrina de Csmith + CompCert**: Yang et al. (PLDI 2011) y Leroy (CACM 2009) — Los conjuntos de datos adversarios prueban un verificador; el "oráculo" no debe consultar el artefacto que está evaluando.
- **Atestación de la cadena de suministro**: in-toto v1, SLSA Provenance v1.0, modelo de transparencia de Sigstore ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — Los "recibos" de `backprop-trace` se pueden incluir como sujetos de una declaración DSSE.

NO es zkML (no es criptografía concisa). NO es opML (no es un juego de detección de fraudes). NO es un registrador de métricas de aprendizaje automático — `backprop-trace` escribe cadenas decimales en lugar de números de punto flotante binarios; es más similar a los "snapshots" de Jest o a "insta" de Rust en espíritu.

## La pila de reglas

De `docs/canonical-emission.md`:

> El contrato precede al motor. La política de formato precede al formato en tiempo de ejecución. Los "recibos" incorrectos preceden a los "recibos" correctos. El formato en tiempo de ejecución precede a Mazur. Mazur precede a los diagnósticos.

## Enlaces

- [`docs/quickstart.md`](./docs/quickstart.md) — Guía rápida de cinco minutos.
- [`docs/cli.md`](./docs/cli.md) — Referencia del subcomando `bp`.
- [`docs/authoring.md`](./docs/authoring.md) — Cómo crear una topología personalizada.
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Las 16 reglas de conciliación.
- [`docs/topology.md`](./docs/topology.md) — Creación de topologías generales.
- [`docs/multi-step.md`](./docs/multi-step.md) — "Recibos" de entrenamiento en múltiples pasos (generados por el motor).
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrato de codificación a nivel de bytes.
- [`docs/computation-order.md`](./docs/computation-order.md) — Orden IEEE 754; prohibición de FMA; tolerancia híbrida; límite de determinismo.
- [`docs/schema.md`](./docs/schema.md) — Recorrido paso a paso del esquema, campo por campo.
- [`docs/attestation.md`](./docs/attestation.md) — Mecanismo de atestación in-toto v1.
- `fixtures/` — "Recibos" canónicos (Mazur, XOR, XOR por sesgo de neurona, iris, softmax-CE, XOR en múltiples pasos), "sidecars" externos y "recibos" en modo observador (PyTorch, JAX, TensorFlow), "recibos" incorrectos deliberadamente creados (uno por regla de conciliación).
- `schemas/` — Esquema de "recibo" v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, entrada de topología v0.4.0, traza del marco v0.1.0 (todos cerrados, anotados con `x-order`, aditivos).
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — La pila de reglas, el mecanismo antirretroceso, la doctrina de que los "recibos" incorrectos preceden a los correctos.
- [`SECURITY.md`](./SECURITY.md) — Qué se considera una vulnerabilidad para un verificador.
- [`CHANGELOG.md`](./CHANGELOG.md) — Historial versión por versión.

## Licencia

MIT — ver `LICENSE`.
