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

Un verificador determinista de 26 reglas para los pasos de entrenamiento de redes neuronales. Se le proporciona un registro que indica cada factor que contribuyó a una actualización de gradiente; el reconciliador vuelve a derivar cada afirmación y rechaza si hay discrepancias. En la línea de Csmith/CompCert, *"el oráculo no debe consultar el artefacto que juzga"*.

> **v1.0.0 — Solo CPU, determinista.** El verificador cubre SGD, Adam, AdamW, SGD con momento (clásico / Nesterov / amortiguación) y **SGD con decaimiento de peso L2 acoplado**, en 26 reglas del reconciliador. Los asistentes en vivo de **PyTorch y JAX** extraen un paso real de entrenamiento en un registro verificable; el observador solo tiene acceso a [la Regla 14](./docs/reconciliation.md), que es la autoridad para cada componente adicional importado. 940 pruebas deterministas; límites de tolerancia definidos por el verificador; mecanismo anti-circularidad. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) antes de usarlo en producción y consulte [CHANGELOG](./CHANGELOG.md) para ver el historial de versiones.

## Inicio rápido de 30 segundos

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

El ejemplo Mazur 2-2-2 es el ejemplo más citado de retropropagación en un solo paso en la web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Cada número en él se puede derivar manualmente.

## De qué se trata esto

Un verificador de corrección numérica para un paso de entrenamiento. El reconciliador recorre 26 reglas que vuelven a derivar cada afirmación a partir de los factores especificados. Si alguna regla no coincide dentro de la tolerancia híbrida (`atol + rtol`), el registro se rechaza. Las reglas multi-paso (Reglas 9 + 10), por lotes (Reglas 18 + 19), las recurrencias de momento de Adam (Reglas 22-24), la recurrencia de momento de SGD (Reglas 20 + 21a/21b/21c + 25 + 26) y el recálculo del motor en los registros importados del marco de trabajo (Regla 14) cubren las áreas relevantes para la producción.

No valida la ejecución completa del entrenamiento, no prueba que el modelo sea correcto ni reemplaza un rastreador de experimentos. Prueba que cada paso registrado es matemáticamente consistente y que la cadena está intacta. Los conjuntos de datos adversarios prueban un verificador ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)); cada regla se envía con un conjunto de pruebas defectuoso emparejado en [`fixtures/bad/`](./fixtures/bad) que el verificador debe rechazar *antes* de leer cualquier metadato de `fixture_status`.

## Asistente de PyTorch en vivo (v0.10+)

Un único archivo Python auditable. No hay paquete pip por diseño; cópielo en su repositorio, léalo y ejecútelo.

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

El asistente emite un componente adicional `framework-trace.v0.7.0` con un bloque de "helper" forense (nombre, versión, hash de origen, versión del marco de trabajo, tiempo de ejecución, marca de tiempo de extracción). El bloque **no es una credencial**: la Regla 14 (diferencial de recálculo del motor) es la autoridad para cada componente adicional emitido por el asistente, independientemente de lo que afirme el asistente. Un `source_hash` falsificado/incorrecto/faltante NO evita la Regla 14. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md) para ver la declaración del límite de confianza, la lista prohibida, el catálogo adversarial de 9 componentes y el contrato de no distribución por pip.

**Admitido**: PyTorch SGD + Adam + AdamW + sgd_momentum (clásico/Nesterov/amortiguación) + **SGD con decaimiento de peso L2 acoplado**, con la inversión del signo `momentum_buffer` de ascenso a descenso por [problema de PyTorch #1099](https://github.com/pytorch/pytorch/issues/1099). Primero, CPU. Un solo paso y múltiples pasos. Un asistente **de JAX en vivo** paralelo (`scripts/extract/jax.py`) cubre SGD + Adam con un límite de confianza más estricto; incluye un resumen de `jax.make_jaxpr(jax.grad(loss))` en el bloque forense (el grafo de gradiente inspeccionable que PyTorch eager no tiene) y se niega a ejecutarse sin `jax_enable_x64` + CPU. Consulte [`docs/live-helpers.md`](./docs/live-helpers.md).
**Rechazado en el límite**: AMP/autocast, CUDA/MPS/XLA, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologías de múltiples capas ocultas. Los componentes adicionales creados manualmente para esos marcos de trabajo/optimizadores siguen funcionando a través de la ruta estándar `bp import`.

## De qué no se trata esto

- **No es un rastreador de experimentos.** Utilice [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard); estos registran las afirmaciones; la retropropagación vuelve a derivar si las matemáticas son internamente consistentes.
- **No es Proof-of-Learning o zkML.** Se demostró que [PoL](https://arxiv.org/abs/2103.05633) se puede falsificar en el entrenamiento real ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produce pruebas criptográficas. La retropropagación no es criptográfica, de un solo paso y su público objetivo son humanos o revisores de CI.
- **No es una atestación de la cadena de suministro.** [Firma de modelos de Sigstore](https://github.com/sigstore/model-transparency), [SLSA para modelos](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) atestiguan el origen del proceso; la retropropagación atestigua la consistencia numérica. Un ML-BOM puede hacer referencia a un registro de retropropagación como un predicado de consistencia interna.

## Modelo de amenazas

En alcance: cualquier registro que debería rechazarse pero se acepta: omisión del esquema, envenenamiento con NaN/Infinito, divergencia de emisión canónica, violaciones de la anti-circularidad, desacuerdo del recálculo del motor en los componentes adicionales importados. Fuera de alcance: confiabilidad de la ejecución del entrenamiento en sí, ataques de canal lateral al proceso del verificador. El determinismo está limitado: solo se garantiza una salida idéntica entre la misma versión de retropropagación, Node.js 22.x y la misma especificación de emisión canónica. Consulte [SECURITY.md](./SECURITY.md) para obtener la enumeración completa + el cronograma de divulgación.

## Instalación

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fijado a Node 22.x (el determinismo de V8 fdlibm `Math.exp` es fundamental; consulte [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI

Referencia completa: [`docs/cli.md`](./docs/cli.md).

| Verbo | Propósito |
|---|---|
| `bp reconcile receipt <file>` | Ejecuta las 26 reglas; sale con código de error 1 en el primer fallo. |
| `bp verify mazur` | Puerta de enlace completa en el componente Mazur incluido. |
| `bp verify general <file>` | Puerta generalizada (v0.2+; comprobantes: XOR, iris, softmax+CE, modo observador) |
| `bp verify multi <file.jsonl>` | JSONL con múltiples registros + reglas entre registros (9/10) |
| `bp generate {mazur,xor,iris}` | Volver a ejecutar el motor especificado y generar bytes canónicos |
| `bp generate from-config <file>` | Volver a ejecutar el motor a partir de una topología y un archivo JSON de entrada |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | Escribir una configuración de entrada inicial |
| `bp validate-input <file>` | Validar una configuración de topología y entrada según un esquema |
| `bp validate <file>` | Validar un comprobante según un esquema (detecta automáticamente las versiones v0.1-v0.7) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Ingerir el seguimiento de un marco externo |
| `bp examples {pytorch,jax} [--print]` | Imprimir la ruta (o mostrar el contenido) del archivo auxiliar de PyTorch/JAX en vivo incluido |

Indicadores comunes: `--out <archivo>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, argumento de archivo `-` = entrada estándar. Códigos de salida: `0` (éxito), `1` (fallo en la verificación), `2` (uso/E/S), `3` (argumento CLI no válido), `4` (marco no implementado).

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

> **¿Qué puerta prueba qué?** `reconcileReceipt` prueba que las operaciones matemáticas del comprobante son
> *internamente consistentes* (las 26 reglas derivan nuevamente cada afirmación a partir de los factores propios del comprobante). Para un comprobante de **origen desconocido**, combínelo con la puerta `engine-reproduce` — `verifyEngineReproduces` (o `bp verify general`), que vuelve a ejecutar el motor determinista a partir de las entradas del comprobante y compara campo por campo. Esa segunda puerta es la que cierra el ciclo anti-circular: la consistencia interna por sí sola no puede detectar un comprobante externo que haya sido
> renombrado como si fuera generado por el motor, porque ninguna regla específica para cada comprobante deriva nuevamente el paso directo para un comprobante generado por el motor. Las importaciones en modo observador (`importPytorchSidecar`) ejecutan automáticamente la comparación diferencial `engine-reproduce` (Regla 14); `bp verify` siempre ejecuta ambas puertas.

Importaciones de subrutas: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, más la familia de esquemas `./schema/...`.

## Las 26 reglas

Declaraciones completas + casos de prueba adversarios: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regla |
|---|---|
| 0 | Centinela de fallo estructural (a nivel de esquema) |
| 0.8 | Límites de probabilidad: salidas softmax en [0, 1] |
| 1-4 | Señales de error (salida, posteriores, ocultas) + consistencia del gradiente de actualización |
| 5-7 | Valor de actualización, progresión de los pesos, estado final (rama AdamW en las reglas 6/7 para la descomposición del peso) |
| 8 | Consistencia de la referencia de procedencia |
| 9-10 | Cadena de parámetros de varios pasos + identidad del seguimiento |
| 11-13 | Normalización softmax + fórmula de pérdida + forma dual (GATED) |
| 14 | Diferencial de recomputación del motor (OBLIGATORIO en las importaciones en modo observador) |
| 15-17 | Vinculación de base de omisión + vinculación de resumen con signo + vinculación de raíz del paquete (GATED) |
| 18-19 | Consistencia de la reducción por lotes + coherencia del conjunto de muestras (GATED) |
| 20 | Forma del estado del optimizador (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **Momento SGD al estilo de PyTorch**: 21a recurrencia del búfer + 21b dirección efectiva + 21c actualización del parámetro |
| 22-24 | Recurrencias del momento Adam + corrección del sesgo + actualización del parámetro (épsilon FUERA de la raíz cuadrada) |
| 25-26 | Cadena del estado del optimizador de varios pasos + constancia de la configuración del optimizador |

## Ámbito de determinismo

Acuerdo contractual en Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.12.x: valores dorados byte a byte (Mazur, XOR, iris, softmax+CE, múltiples pasos, por lotes, archivos adjuntos externos); el ancla Mazur `post_update_loss.total = 0.29102777369359933`; reconciliación por regla dentro de `atol=1e-12`, `rtol=1e-9` para comprobantes generados por el motor.

NO es un acuerdo contractual: entre motores (Bun, Deno, navegadores); entre versiones principales de Node (24.x+); cambios menores arbitrarios en V8. Un "canario" `Math.exp(-0.5)` se activa en cada celda de CI como una sirena de deriva fdlibm de V8.

## Lo que no está en esta versión (todavía)

v1.0.0 cubre el caso límite determinista-CPU de extremo a extremo: el motor, el reconciliador, el acuerdo sobre la emisión canónica, la ruta de ingestión externa, los auxiliares de PyTorch **y** JAX en vivo, los optimizadores de la familia SGD que incluyen la descomposición del peso L2 acoplado, un caso de prueba heroico reconocible y un [paquete de cumplimiento](docs/compliance.md) funcional. El mapa de ruta a continuación es lo que **no está cubierto todavía deliberadamente**, ordenado por uso × viabilidad de verificación, cada uno sujeto a una recomputación cerrada del CPU que el reconciliador realmente pueda gestionar:

- **NAdam (+ opcionalmente RAdam)**: variantes económicas de Adam. Luego, **verificación del programa de tasa de aprendizaje**, que se combina con cada optimizador. *A continuación*.
- **AMSGrad / recorte de gradiente de norma global / tasas de aprendizaje por grupo / Lion**: cada uno activado mediante una extensión de registro/reconciliación. *Más adelante*.
- **Topologías Conv / multi-capa oculta**: el motor es denso de una sola capa oculta; la característica principal es un clasificador denso ReLU→softmax reconocible. Conv introduce un ordenamiento FP de kernel fusionado que combate el determinismo a nivel de bits (ver GPU más abajo). *Probablemente fuera del ámbito de determinismo en la CPU*.
- **Trazas multi-framework heterogéneas**: solo se admiten paquetes de un único framework; las secuencias de frameworks mixtos no son compatibles. *Podría quedar fuera del alcance*.
- **Tamaños de lote heterogéneos entre pasos**: tamaño de lote fijo por secuencia. *Podría quedar fuera del alcance*.
- **Gradientes por muestra en registros agrupados**: solo se reducen los gradientes hoy; la descomposición por muestra es útil para auditorías de influencia, pero aún no está disponible. *Más adelante*.
- **Vinculación de identidad del productor en trazas multi-paso**: la regla 17 detecta fallos en la integridad del paquete, no la autenticidad del productor. Combinar con la regla 16 / Sigstore / atestación fuera de banda. Superficie del operador, no una función integrada.
- **GPU / determinismo a nivel de bits de kernel fusionado**: fuera del alcance y permanente. La no asociatividad de punto flotante hace que la exactitud a nivel de bits sea inalcanzable en kernels fusionados/paralelos ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148); operaciones atómicas cuDNN ConvolutionBackwardFilter por [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). El resultado es el ámbito de CPU determinista.

Si su flujo de trabajo depende de alguno de estos, esta no es la versión adecuada para usted todavía.

## Crear una topología personalizada

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulte [`docs/authoring.md`](./docs/authoring.md): esquemas de entrada frente a registro, límite de confianza de emisión canónica.

## Dónde encaja esto

- **Autores de artículos que priorizan la reproducibilidad** (NeurIPS/ICML/CoLLAs; conscientes de [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)): evidencia por paso que se puede volver a derivar y que el revisor ejecuta en 30 segundos.
- **Pedagogía del aprendizaje automático** (Karpathy de cero a héroe, cursos universitarios de aprendizaje profundo, preparación para entrevistas): un único paso de entrenamiento con nombre donde todos los factores son visibles y un reconciliador que *rechaza* las configuraciones deliberadamente defectuosas.
- **Ingenieros de frameworks / compiladores de aprendizaje automático** (colaboradores de PyTorch / JAX / MLIR / XLA): traza conocida y válida por operación para pruebas diferenciales.
- **Ingenieros de cumplimiento / auditoría del aprendizaje automático** ([Anexo IV §2(g) de la Ley de IA de la UE, registros de validación/pruebas + Artículo 15 sobre robustez](https://artificialintelligenceact.eu/annex/4/); SLSA para el aprendizaje automático): un registro por paso como un registro de prueba verificable, fechado y con firma que se encuentra debajo de la firma del modelo. Consulte el paquete de cumplimiento trabajado [./docs/compliance.md](docs/compliance.md) (y el alcance honesto: los registros atestiguan las *matemáticas*, no la gobernanza de datos).

## La pila legal

De `docs/canonical-emission.md`:

> El contrato precede al motor. La política del formateador precede al formato en tiempo de ejecución. Los registros incorrectos preceden a los registros correctos. El formato en tiempo de ejecución precede a Mazur. Mazur precede a los diagnósticos.

## Enlaces

- [`docs/quickstart.md`](./docs/quickstart.md): recorrido de cinco minutos
- [`docs/cli.md`](./docs/cli.md): referencia del subcomando `bp`
- [`docs/live-helpers.md`](./docs/live-helpers.md): ayudante de PyTorch en vivo v0.10: flujo de trabajo, límite de confianza, catálogo adversarial, justificación para no usar pip
- [`docs/authoring.md`](./docs/authoring.md): crear una topología personalizada
- [`docs/reconciliation.md`](./docs/reconciliation.md): las 26 reglas del reconciliador en su totalidad
- [`docs/topology.md`](./docs/topology.md): creación de topologías generales
- [`docs/multi-step.md`](./docs/multi-step.md): registros de entrenamiento multi-paso
- [`docs/canonical-emission.md`](./docs/canonical-emission.md): contrato de codificación a nivel de bytes
- [`docs/computation-order.md`](./docs/computation-order.md): ordenamiento IEEE 754; prohibición de FMA; límite de determinismo
- [`docs/schema.md`](./docs/schema.md): recorrido del esquema campo por campo
- [`docs/attestation.md`](./docs/attestation.md): punto de atestación in-toto v1
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): trinquete anti-circularidad; doctrina de "los registros incorrectos preceden a los buenos"
- [`SECURITY.md`](./SECURITY.md): qué se considera una vulnerabilidad para un verificador
- [`CHANGELOG.md`](./CHANGELOG.md): historial por versión

## Licencia

MIT: consulte [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
