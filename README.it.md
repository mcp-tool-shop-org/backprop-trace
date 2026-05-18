<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Un verificatore deterministico con 26 regole per le fasi di addestramento delle reti neurali. Gli si fornisce un file che elenca tutti i fattori che hanno contribuito a un singolo aggiornamento del gradiente; il verificatore ricontrolla ogni affermazione e rifiuta in caso di discrepanza. In linea con la filosofia di Csmith/CompCert, secondo cui *"l'oracolo non deve consultare l'artefatto che sta valutando."*

> **Stato: versione 0.11.0 (mid-v0) — prima versione pubblicabile.** Solo per CPU. Il verificatore copre SGD + Adam + AdamW + momentum di SGD in stile PyTorch (classico + Nesterov + smorzamento).
> Un'utilità di supporto PyTorch ( `scripts/extract/pytorch.py`) copre la stessa matrice di ottimizzatori. Funziona solo come osservatore; la [Regola 14](./docs/reconciliation.md) è l'autorità.
> La versione 0.11.0 è la prima versione pubblicata tramite npm; la versione 1.0 è ancora in fase di sviluppo e richiede [validazione con esempi reali + validazione da parte degli utenti + utilità di supporto live per diversi framework](#whats-not-in-this-version-yet). Consultare [`docs/live-helpers.md`](./docs/live-helpers.md) prima dell'utilizzo in produzione.

## Guida rapida (30 secondi)

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

"Mazur 2-2-2" è la spiegazione passo-passo più citata della retropropagazione disponibile online ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Ogni numero in essa è derivabile manualmente.

## Di cosa si tratta

Un verificatore della correttezza numerica per una singola fase di addestramento. Il verificatore applica 26 regole per ricontrollare ogni affermazione a partire dai fattori indicati. Se una qualsiasi regola presenta una discrepanza all'interno della tolleranza ibrida (`atol + rtol`), il file viene rifiutato. Le regole 9 e 10 (multi-step), le regole 18 e 19 (batch), le regole 22-24 (ricorrenze di Adam), le regole 20 e 21a/21b/21c + 25 + 26 (ricorrenze di momentum di SGD) e la regola 14 (ricalcolo differenziale del motore a partire dalle tracce del framework importato) coprono le aree rilevanti per la produzione.

Non valida l'intera esecuzione di addestramento, non dimostra che il modello sia corretto e non sostituisce un sistema di tracciamento degli esperimenti. Dimostra che ogni fase registrata è matematicamente coerente e che la catena è intatta. I set di dati avversari dimostrano l'utilità di un verificatore ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — ogni regola è fornita con un esempio di input errato presente nella directory [`fixtures/bad/`](./fixtures/bad/) che il verificatore deve rifiutare *prima* di leggere qualsiasi metadato `fixture_status`.

## Utilità di supporto PyTorch (versione 0.10+)

Un singolo file Python leggibile. Non è progettato per essere un pacchetto pip; è necessario copiarlo nel proprio repository, leggerlo ed eseguirlo.

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

L'utilità genera un file "sidecar" chiamato `framework-trace.v0.7.0` contenente un blocco "helper" forense (nome, versione, hash della sorgente, versione del framework, runtime, timestamp di estrazione). Questo blocco **non è una credenziale**; la Regola 14 (ricalcolo differenziale del motore) è l'autorità per ogni file "sidecar" generato dall'utilità, indipendentemente da ciò che l'utilità stessa dichiara. Un `source_hash` contraffatto, errato o mancante NON aggira la Regola 14. Consultare [`docs/live-helpers.md`](./docs/live-helpers.md) per la dichiarazione sui confini di fiducia, l'elenco dei componenti proibiti, il catalogo di esempi avversari (9 esempi) e il contratto di distribuzione senza pip.

**Supportato (versione 0.10.x)**: PyTorch SGD + Adam + AdamW + sgd_momentum (classico/Nesterov/smorzamento, con l'inversione di segno del buffer di momentum da "ascesa" a "discesa" come indicato nel [problema #1099 di PyTorch](https://github.com/pytorch/pytorch/issues/1099)). Ottimizzato per CPU. Supporta sia singole che multiple fasi.
**Escluso dai test**: AMP/autocast, CUDA/MPS/XLA, SGD con decadimento del peso L2 accoppiato, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologie con più livelli nascosti. Le utilità di supporto create manualmente per questi framework/ottimizzatori continuano a funzionare tramite il percorso standard `bp import`.

## Cosa questo strumento non fa

- **Non è un sistema di tracciamento degli esperimenti.** Utilizzate [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard): questi strumenti registrano i risultati; `backprop-trace` verifica la coerenza interna dei calcoli.
- **Non è una prova di apprendimento (Proof-of-Learning) né zkML.** È stato dimostrato che [PoL](https://arxiv.org/abs/2103.05633) può essere falsificato durante l'addestramento reale ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produce prove crittografiche. `backprop-trace` non è crittografico, opera in un singolo passaggio ed è destinato a essere utilizzato da esseri umani o da revisori di sistemi di controllo (CI).
- **Non è un sistema di attestazione della catena di fornitura.** [La firma dei modelli con Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestano l'origine del processo; `backprop-trace` attesta la coerenza numerica. Un ML-BOM può fare riferimento a un risultato di `backprop-trace` come predicato di coerenza interna.

## Modello di minaccia

Ambito: qualsiasi risultato che dovrebbe essere rifiutato ma viene accettato: bypass dello schema, avvelenamento con NaN/Infinity, divergenza dell'emissione canonica, violazioni dell'anti-circularità, discrepanze nel ricalcolo del motore con moduli aggiuntivi. Fuori dall'ambito: affidabilità dell'esecuzione di addestramento stessa, attacchi laterali al processo di verifica. Il determinismo è limitato: l'output byte-identico è garantito solo all'interno della stessa versione di `backprop-trace`, con Node.js 22.x e con la stessa specifica di emissione canonica. Consultare [SECURITY.md](./SECURITY.md) per l'elenco completo e la cronologia delle divulgazioni.

## Installazione

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Bloccato alla versione Node 22.x (la determinazione di `Math.exp` di V8 fdlibm è fondamentale; vedere [`docs/computation-order.md`](./docs/computation-order.md)).

## Interfaccia a riga di comando (CLI)

Riferimento completo: [`docs/cli.md`](./docs/cli.md).

| Comando | Scopo |
|---|---|
| `bp reconcile receipt <file>` | Esegue tutte le 26 regole; esce con codice 1 in caso di primo errore. |
| `bp verify mazur` | Verifica completa dell'esempio Mazur integrato. |
| `bp verify general <file>` | Verifica generalizzata (i risultati v0.2+ includono: XOR, iris, softmax+CE, modalità observer). |
| `bp verify multi <file.jsonl>` | Elaborazione di file JSONL multi-record + regole 9/10. |
| `bp generate {mazur,xor,iris}` | Riesegue il motore specificato, emette byte canonici. |
| `bp generate from-config <file>` | Riesegue il motore a partire da una topologia e un input in formato JSON. |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | Crea un file di configurazione di esempio. |
| `bp validate-input <file>` | Valida lo schema di una topologia e di un input. |
| `bp validate <file>` | Valida lo schema di un risultato (rileva automaticamente le versioni da 0.1 a 0.7). |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Importa un tracciato di un framework esterno. |
| `bp examples pytorch [--print]` | Stampa il percorso (o visualizza il contenuto) dell'helper PyTorch integrato. |

Flag comuni: `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, l'argomento file `-` rappresenta l'input standard. Codici di uscita: `0` successo · `1` errore di verifica · `2` utilizzo/I/O · `3` argomento CLI non valido · `4` framework non implementato.

## Libreria

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

Importazioni da sottodirectory: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, più la famiglia di schemi `./schema/...`.

## Le 16 regole

Dichiarazioni complete + esempi avversari: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regola |
|---|---|
| 0 | Sentinella di errore strutturale (a livello di schema) |
| 0.8 | Limiti di probabilità: output softmax compresi tra [0, 1] |
| 1-4 | Segnali di errore (output, downstream, nascosti) + coerenza dell'aggiornamento del gradiente. |
| 5-7 | Aggiornamento del valore, progressione dei pesi, stato finale (ramo AdamW per il decadimento del peso disaccoppiato nelle regole 6/7). |
| 8 | Coerenza del riferimento di provenienza |
| 9-10 | Catena di parametri multi-step + identità del tracciato. |
| 11-13 | Normalizzazione softmax + formula della perdita + forma duale (GATED). |
| 14 | Differenziale del ricalcolo del motore (OBBLIGATORIO nelle importazioni in modalità observer). |
| 15-17 | Base di salto + binding della firma + binding della radice del pacchetto (GATED). |
| 18-19 | Coerenza della riduzione del batch + coerenza dell'insieme di campioni (GATED). |
| 20 | Forma dello stato dell'ottimizzatore (Adam `{m, v}` / sgd_momentum `{buffer}`). |
| 21 | **Momento SGD in stile PyTorch**: 21a ricorrenza del buffer + 21b direzione effettiva + 21c aggiornamento dei parametri. |
| 22-24 | Adam: aggiornamenti ricorrenti dei parametri + correzione del bias + aggiornamento dei parametri (epsilon al di fuori della radice quadrata). |
| 25-26 | Catena di ottimizzatori multi-step + costanza della configurazione dell'ottimizzatore. |

## Ambito del determinismo

Test contrattuali su Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x: verifica della corrispondenza byte con i valori di riferimento (Mazur, XOR, iris, softmax+CE, multi-step, batch, sidecar esterni); l'ancora Mazur `post_update_loss.total = 0.29102777369359933`; riconciliazione per regola entro `atol=1e-12`, `rtol=1e-9` per le funzionalità implementate dal motore.

NON contrattuali: cross-engine (Bun, Deno, browser); cross-Node-major (24.x+); aggiornamenti minori arbitrari di V8. Un "canary" di `Math.exp(-0.5)` viene attivato in ogni cella CI come segnale di avvertimento per la deriva di fdlibm di V8.

## Cosa non è incluso in questa versione (ancora)

La versione v0.11.0 di backprop-trace è la prima versione pubblicata tramite npm, ma è **ancora in fase beta (v0.x)**. Il motore, il riconciliatore, il contratto di emissione canonica, il percorso di ingestione esterno e l'helper live per PyTorch sono reali e stabili. La versione 1.0 richiede che questi elementi siano completati:

- **Tracce multi-framework eterogenee** — solo bundle per framework singolo; non sono supportati flussi multi-framework. *Potrebbe rimanere fuori dall'ambito.*
- **Binding dell'identità del produttore nelle tracce multi-step** — la regola 17 rileva i fallimenti dell'integrità del bundle, non l'autenticità del produttore. Combinare con la regola 16 / Sigstore / attestazione fuori banda. Superficie per operatori, non integrata.
- **Decadimento del peso L2 accoppiato a SGD** — ramo 3 della regola 7; *v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / gruppi di parametri per parametro / pianificazioni del tasso di apprendimento / clipping del gradiente / precisione mista** — *v0.10+.*
- **Gradienti per campione nei ricevuti batch** — solo gradienti ridotti attualmente; la decomposizione per campione è utile per le verifiche di influenza. *v0.10.x / v0.11.*
- **Dimensioni batch eterogenee tra i passaggi** — dimensione del batch fissa per flusso. *Potrebbe rimanere fuori dall'ambito.*
- **Helper live per JAX / TensorFlow** — i sidecar scritti manualmente funzionano; gli helper live sono *v0.11 (JAX, attivazione adopter-pull) / v0.12+ (TF).*
- **Fixture di esempio reale** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur sono i protagonisti; il piccolo fixture CNN / blocco transformer è *v0.11.*
- **Validazione dell'adottante** — nessun caso di studio di ricercatori esterni, nessuna adozione in corsi, nessun bundle di conformità nel mondo reale. *v0.12 prima della v1.0.*
- **Determinismo della GPU** — fuori dall'ambito e probabilmente permanente (le operazioni atomiche di cuDNN ConvolutionBackwardFilter invalidano la precisione bit-esatta [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La posizione del prodotto è l'angolo deterministico della CPU.

Se il tuo flusso di lavoro dipende da una di queste funzionalità, questa non è la versione giusta per te.

## Definire una topologia personalizzata

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consultare [`docs/authoring.md`](./docs/authoring.md) — schemi di input rispetto ai ricevuti, limite di fiducia per l'emissione canonica.

## A chi è rivolto

- **Autori di articoli incentrati sulla riproducibilità** (NeurIPS/ICML/CoLLAs; consapevoli di [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) — evidenza derivabile per ogni passaggio che il revisore esegue in 30 secondi.
- **Didattica dell'apprendimento automatico** (Karpathy zero-to-hero, corsi universitari di deep learning, preparazione ai colloqui) — un singolo passaggio di addestramento denominato con tutti i fattori visibili e un riconciliatore che *rifiuta* i fixture intenzionalmente danneggiati.
- **Ingegneri di framework / compilatori ML** (contributori di PyTorch / JAX / MLIR / XLA) — traccia per operazione nota e affidabile per i test differenziali.
- **Ingegneri di conformità / audit ML** ([EU AI Act Article 10](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — ricevuta per ogni passaggio sotto la firma del modello, allegata a una scheda del modello o a un bundle di audit.

## La struttura legale

Da `docs/canonical-emission.md`:

> Il contratto precede il motore. La politica di formattazione precede la formattazione a runtime. Le ricevute errate precedono le ricevute corrette. La formattazione a runtime precede Mazur. Mazur precede le diagnostiche.

## Link

- [`docs/quickstart.md`](./docs/quickstart.md) — Guida introduttiva di cinque minuti.
- [`docs/cli.md`](./docs/cli.md) — Riferimento del comando `bp`.
- [`docs/live-helpers.md`](./docs/live-helpers.md) — Funzioni di supporto live per PyTorch v0.10: flusso di lavoro, confine di fiducia, catalogo di esempi avversari, motivazioni per non utilizzare pip.
- [`docs/authoring.md`](./docs/authoring.md) — Come creare una topologia personalizzata.
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Tutte le 26 regole di riconciliazione.
- [`docs/topology.md`](./docs/topology.md) — Creazione di topologie generali.
- [`docs/multi-step.md`](./docs/multi-step.md) — Procedure di training a più passaggi.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contratto di codifica a livello di byte.
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordinamento IEEE 754; divieto di FMA; confine del determinismo.
- [`docs/schema.md`](./docs/schema.md) — Guida dettagliata dello schema, campo per campo.
- [`docs/attestation.md`](./docs/attestation.md) — Meccanismo di attestazione in-toto v1.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Meccanismo anti-circolarità; principio "le ricevute errate precedono quelle corrette".
- [`SECURITY.md`](./SECURITY.md) — Cosa costituisce una vulnerabilità per un verificatore.
- [`CHANGELOG.md`](./CHANGELOG.md) — Cronologia delle versioni.

## Licenza

MIT — vedere [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
