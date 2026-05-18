<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Un verificador determinista de 26 reglas para los pasos de entrenamiento de redes neuronales. Se le proporciona un registro que enumera cada factor que contribuyó a una actualización del gradiente; el verificador vuelve a derivar cada afirmación y la rechaza si hay discrepancias. Sigue la línea de Csmith/CompCert, donde *"el oráculo no debe consultar el artefacto que está juzgando."*

> **Estado: versión preliminar v0 (v0.11.0) — primera versión publicable.** Solo para CPU. El verificador cubre SGD + Adam + AdamW + el impulso de SGD al estilo de PyTorch (clásico + Nesterov + amortiguación).
> Un asistente de PyTorch ( `scripts/extract/pytorch.py`) cubre la misma matriz de optimizadores. Solo es un observador; [la regla 14](./docs/reconciliation.md) es la autoridad.
> La versión 0.11 es la primera versión publicada en npm; la versión 1.0 aún depende de [un caso práctico real + validación del usuario + asistentes en vivo para múltiples frameworks](#whats-not-in-this-version-yet). Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) antes de usarlo en producción.

## Guía de inicio rápido de 30 segundos

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

El ejemplo de retropropagación paso a paso de Mazur 2-2-2 es el más citado en la web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Cada número en él puede derivarse manualmente.

## ¿Qué es esto?

Un verificador de corrección numérica para un solo paso de entrenamiento. El verificador aplica 26 reglas que vuelven a derivar cada afirmación a partir de los factores nombrados. Si alguna regla no coincide dentro de la tolerancia híbrida (`atol + rtol`), el registro se rechaza. Las reglas 9 y 10 (pasos múltiples), las reglas 18 y 19 (lotes), las reglas 22-24 (recurrencias de momento de Adam), las reglas 20 y 21a/21b/21c + 25 + 26 (recurrencia de momento de SGD) y la regla 14 (recálculo diferencial del motor en rastreos de frameworks importados) cubren las áreas relevantes para la producción.

No valida la ejecución de entrenamiento completa, no prueba que el modelo sea correcto ni reemplaza un rastreador de experimentos. Prueba que cada paso registrado es matemáticamente consistente y que la cadena está intacta. Los corpus adversarios demuestran la utilidad de un verificador ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — cada regla viene con un caso de prueba incorrecto asociado en [`fixtures/bad/`](./fixtures/bad/) que el verificador debe rechazar *antes* de leer cualquier metadato de `fixture_status`.

## Asistente de PyTorch (v0.10+)

Un único archivo de Python auditable. No se distribuye como paquete de pip por diseño; cópielo en su repositorio, léalo y ejecútelo.

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

El asistente genera un archivo auxiliar `framework-trace.v0.7.0` con un bloque forense `helper` (nombre, versión, hash de origen, versión del framework, entorno de ejecución, marca de tiempo de extracción). Este bloque **no es una credencial**; la regla 14 (recálculo diferencial del motor) es la autoridad sobre cada archivo auxiliar generado, independientemente de lo que afirme el asistente. Un `source_hash` falsificado, incorrecto o faltante NO evita la regla 14. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) para la declaración de límite de confianza, la lista de elementos prohibidos, el catálogo de casos de prueba adversarios de 9 elementos y el contrato de señal de cambio de distribución sin pip.

**Soportado (v0.10.x)**: PyTorch SGD + Adam + AdamW + sgd_momentum (clásico/Nesterov/amortiguación, con el cambio de signo de ascenso→descenso del `momentum_buffer` según [el problema #1099 de PyTorch](https://github.com/pytorch/pytorch/issues/1099)). Prioridad para CPU. Paso único y múltiple.
**Rechazado en el límite**: AMP/autocast, CUDA/MPS/XLA, SGD con decaimiento de peso acoplado L2, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologías de múltiples capas ocultas. Los archivos auxiliares creados manualmente para esos frameworks/optimizadores siguen funcionando a través de la ruta estándar `bp import`.

## Esto no es..

- **No es un rastreador de experimentos.** Utilice [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard): estos registran información; `backprop-trace` vuelve a derivar si la matemática es internamente consistente.
- **No es una prueba de aprendizaje (Proof-of-Learning) ni zkML.** Se demostró que [PoL](https://arxiv.org/abs/2103.05633) es falsificable en entrenamientos reales ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produce pruebas criptográficas. `backprop-trace` no es criptográfico, es de un solo paso y está diseñado para ser revisado por humanos o por sistemas de integración continua (CI).
- **No es una certificación de la cadena de suministro.** [La firma de modelos de Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) certifican el origen del proceso; `backprop-trace` verifica la consistencia numérica. Un ML-BOM puede referenciar un registro de `backprop-trace` como un predicado de consistencia interna.

## Modelo de amenazas

Dentro del alcance: cualquier registro que debería ser rechazado pero es aceptado: omisión de esquemas, envenenamiento con NaN/Infinito, divergencia de la emisión canónica, violaciones de la no circularidad, desacuerdo en el re-cálculo del motor con módulos auxiliares importados. Fuera del alcance: la confiabilidad de la ejecución de entrenamiento en sí misma, ataques de canal lateral en el proceso de verificación. El determinismo está limitado: la salida idéntica en bytes solo está garantizada para la misma versión de `backprop-trace`, Node.js 22.x y la misma especificación de emisión canónica. Consulte [SECURITY.md](./SECURITY.md) para obtener la lista completa y el cronograma de divulgación.

## Instalación

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Vinculado a Node 22.x (el determinismo de `Math.exp` de V8 fdlibm es crucial; consulte [`docs/computation-order.md`](./docs/computation-order.md)).

## Interfaz de línea de comandos (CLI)

Referencia completa: [`docs/cli.md`](./docs/cli.md).

| Verbo | Propósito |
|---|---|
| `bp reconcile receipt <file>` | Ejecuta las 26 reglas; sale con código 1 en caso del primer fallo. |
| `bp verify mazur` | Prueba completa con el fixture de Mazur incluido. |
| `bp verify general <file>` | Prueba generalizada (recibos v0.2+: XOR, iris, softmax+CE, modo observador). |
| `bp verify multi <file.jsonl>` | JSONL de múltiples registros + Reglas 9/10 entre registros. |
| `bp generate {mazur,xor,iris}` | Re-ejecuta el motor especificado, emite bytes canónicos. |
| `bp generate from-config <file>` | Re-ejecuta el motor a partir de una topología y una entrada en formato JSON. |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | Escribe una configuración de entrada inicial. |
| `bp validate-input <file>` | Valida el esquema de una topología y una entrada. |
| `bp validate <file>` | Valida el esquema de un registro (detecta automáticamente las versiones v0.1-v0.7). |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Importa un registro de un framework externo. |
| `bp examples pytorch [--print]` | Imprime la ruta de (o muestra el contenido de) el helper de PyTorch incluido. |

Flags comunes: `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, el argumento de archivo `-` representa la entrada estándar (stdin). Códigos de salida: `0` (éxito) · `1` (fallo en la verificación) · `2` (uso/I-O) · `3` (argumento de la CLI inválido) · `4` (framework no implementado).

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

Importaciones de subdirectorios: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, además de la familia de esquemas `./schema/...`.

## Las 16 reglas

Declaraciones completas + fixtures adversarios: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regla |
|---|---|
| 0 | Indicador de fallo estructural (a nivel de esquema) |
| 0.8 | Límites de probabilidad: las salidas de softmax deben estar en el rango [0, 1] |
| 1-4 | Señales de error (salida, posteriores, ocultas) + consistencia de la actualización del gradiente. |
| 5-7 | Actualización del valor, progresión del peso, estado final (rama AdamW para wd desacoplado en las Reglas 6/7). |
| 8 | Consistencia de la referencia de origen |
| 9-10 | Cadena de parámetros de múltiples pasos + identidad de la traza. |
| 11-13 | Normalización softmax + fórmula de la pérdida + forma dual (GATED). |
| 14 | Diferencial de re-cálculo del motor (OBLIGATORIO en el modo observador). |
| 15-17 | Base de salto + enlace de resumen firmado + enlace de raíz del paquete (GATED). |
| 18-19 | Consistencia de la reducción por lotes + coherencia del conjunto de muestras (GATED). |
| 20 | Forma del estado del optimizador (Adam `{m, v}` / sgd_momentum `{buffer}`). |
| 21 | **Momento SGD al estilo de PyTorch**: 21a recurrencia del buffer + 21b dirección efectiva + 21c actualización del parámetro. |
| 22-24 | Adam: actualizaciones recurrentes del momento + corrección de sesgo + actualización de parámetros (epsilon FUERA de la raíz cuadrada). |
| 25-26 | Cadena de estados del optimizador de múltiples pasos + constancia de la configuración del optimizador. |

## Ámbito del determinismo

Compatible con Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x: valores de referencia byte a byte (Mazur, XOR, iris, softmax+CE, multi-paso, por lotes, complementos externos); el ancla de Mazur `post_update_loss.total = 0.29102777369359933`; conciliación por regla dentro de `atol=1e-12`, `rtol=1e-9` para elementos generados por el motor.

NO compatible: entre motores (Bun, Deno, navegadores); entre versiones principales de Node (24.x+); incrementos arbitrarios de la versión secundaria de V8. Un "canario" `Math.exp(-0.5)` se activa en cada celda de CI como una alerta de deriva de fdlibm de V8.

## Lo que no está en esta versión (todavía)

backprop-trace v0.11.0 es la primera versión publicada en npm, pero **todavía está en la versión 0.x**. El motor, el conciliador, el contrato de emisión canónica, la ruta de ingesta externa y el asistente en vivo de PyTorch son reales y estables. La versión 1.0 requiere que se completen los siguientes elementos:

- **Trazas de marcos múltiples y heterogéneos** — solo se admiten paquetes de un solo marco; no se admiten flujos de marcos mixtos. *Puede quedar fuera del alcance.*
- **Enlace de identidad del productor en trazas de múltiples pasos** — La regla 17 detecta fallos de integridad del paquete, no la autenticidad del productor. Combine con la regla 16 / Sigstore / atestación fuera de banda. Superficie de operador, no una función integrada.
- **Decaimiento de peso L2 acoplado a SGD** — Rama 3 de la regla 7; *v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / grupos de parámetros por parámetro / programas de tasa de aprendizaje / recorte de gradiente / precisión mixta** — *v0.10+.*
- **Gradientes por muestra en recibos por lotes** — solo se reducen los gradientes actualmente; la descomposición por muestra es útil para auditorías de influencia. *v0.10.x / v0.11.*
- **Tamaños de lote heterogéneos en cada paso** — tamaño de lote fijo por flujo. *Puede quedar fuera del alcance.*
- **Asistentes en vivo de JAX / TensorFlow** — los complementos creados manualmente funcionan; los asistentes en vivo son *v0.11 (JAX, activación de adopter-pull) / v0.12+ (TF).*
- **Configuración de prueba del mundo real** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur son los héroes; la configuración de CNN pequeña / bloque de transformador es *v0.11.*
- **Validación del adoptante** — no hay estudios de casos de investigadores externos, no hay adopción en cursos, no hay paquete de cumplimiento en producción. *v0.12 antes de v1.0.*
- **Determinismo de GPU** — fuera del alcance y probablemente permanente (las operaciones atómicas de cuDNN ConvolutionBackwardFilter impiden la exactitud de bits por [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La posición del producto es la esquina determinista de la CPU.

Si su flujo de trabajo depende de alguno de estos elementos, esta no es la versión adecuada para usted todavía.

## Cree una topología personalizada

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulte [`docs/authoring.md`](./docs/authoring.md) — esquemas de entrada frente a esquemas de recibo, límite de confianza de emisión canónica.

## Para qué sirve esto

- **Autores de artículos centrados en la reproducibilidad** (NeurIPS/ICML/CoLLAs; conscientes de [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) — evidencia paso a paso que se puede derivar, que el revisor ejecuta en 30 segundos.
- **Pedagogía de ML** (Karpathy zero-to-hero, cursos universitarios de DL, preparación para entrevistas) — un único paso de entrenamiento con todos los factores visibles y un conciliador que *rechaza* configuraciones deliberadamente incorrectas.
- **Ingenieros de marcos / compiladores de ML** (PyT

## La pila de reglas

De `docs/canonical-emission.md`:

> El contrato precede al motor. La política de formato precede al formato en tiempo de ejecución. Los "recibos" incorrectos preceden a los "recibos" correctos. El formato en tiempo de ejecución precede a Mazur. Mazur precede a los diagnósticos.

## Enlaces

- [`docs/quickstart.md`](./docs/quickstart.md) — Guía rápida de cinco minutos.
- [`docs/cli.md`](./docs/cli.md) — Referencia del subcomando `bp`.
- [`docs/live-helpers.md`](./docs/live-helpers.md) — Asistentes en vivo de PyTorch v0.10: flujo de trabajo, límite de confianza, catálogo de ejemplos adversarios, justificación de la no utilización de `pip`.
- [`docs/authoring.md`](./docs/authoring.md) — Cómo crear una topología personalizada.
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Las 26 reglas de reconciliación en detalle.
- [`docs/topology.md`](./docs/topology.md) — Creación de topologías generales.
- [`docs/multi-step.md`](./docs/multi-step.md) — Recetas de entrenamiento en múltiples pasos.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrato de codificación a nivel de bytes.
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordenamiento IEEE 754; prohibición de FMA; límite de determinismo.
- [`docs/schema.md`](./docs/schema.md) — Descripción detallada del esquema, campo por campo.
- [`docs/attestation.md`](./docs/attestation.md) — Mecanismo de certificación in-toto v1.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Mecanismo para evitar la circularidad; doctrina de "las recetas incorrectas preceden a las correctas".
- [`SECURITY.md`](./SECURITY.md) — ¿Qué se considera una vulnerabilidad para un verificador?
- [`CHANGELOG.md`](./CHANGELOG.md) — Historial de versiones.

## Licencia

MIT — consulte [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
