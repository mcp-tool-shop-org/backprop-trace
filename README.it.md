<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

Un verificatore strutturale deterministico per le singole fasi di addestramento di una rete neurale: un sistema di riconciliazione con 16 regole che ricava gradienti, segnali e aggiornamenti dei parametri dai fattori specificati e genera ricevute in formato JSONL byte-aligned. In linea con la filosofia di Csmith/CompCert: *"l'oracolo non deve consultare l'artefatto che giudica."*

> **Stato: versione mid-v0 (v0.7.0).** Il motore principale e il sistema di riconciliazione sono funzionanti e disponibili. Supporta l'elaborazione a singolo passaggio, solo CPU, solo SGD e con un singolo campione. Attualmente, le tracce del framework esterno sono create manualmente. Consultare la sezione "[Cosa non è incluso in questa versione (ancora)]](#whats-not-in-this-version-yet) prima di utilizzare questo strumento per attività di produzione.

## Guida rapida (30 secondi)

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

Mazur 2-2-2 è la guida più citata per la retropropagazione a singolo passaggio disponibile online (Matt Mazur, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). È un esempio di riferimento perché ogni numero in esso è derivabile manualmente. Per la propria traccia, consultare [Fornire la propria traccia di addestramento](#bring-your-own-training-trace).

## Di cosa si tratta

backprop-trace è un verificatore di correttezza numerica per *una singola* fase di addestramento di una rete neurale. Gli si fornisce una ricevuta, un record JSONL che elenca ogni fattore che ha contribuito a un singolo aggiornamento del gradiente, e il sistema di riconciliazione applica 16 regole per ricavare ogni affermazione dai fattori specificati. Se una qualsiasi regola non corrisponde entro una tolleranza ibrida (`atol + rtol`, forma massima simmetrica), la ricevuta viene rifiutata.

I principi fondamentali sono Csmith (Yang, Chen, Eide, Regehr — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) e CompCert (Leroy, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)): i corpi di test avversari dimostrano la validità di un verificatore, mentre i test superati non lo fanno. Ogni regola del sistema di riconciliazione viene fornita con un esempio di riferimento deliberatamente errato nella directory [`fixtures/bad/`](./fixtures/bad) che il verificatore deve rifiutare *prima* di leggere qualsiasi metadato del ciclo di vita `fixture_status`. Questa disciplina di anti-circularità — l'oracolo non deve consultare l'artefatto che giudica — è la proprietà fondamentale.

## Cosa questo strumento *non* è

- **Non è un sistema di tracciamento degli esperimenti.** Se si desiderano curve di perdita, dashboard o archiviazione di esecuzioni longitudinali, utilizzare [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai) o [TensorBoard](https://www.tensorflow.org/tensorboard). Questi strumenti registrano ciò che l'addestratore dichiara sia accaduto. backprop-trace ricava se la matematica è internamente coerente. Sono strumenti complementari, non sovrapponibili.
- **Non è una prova di apprendimento (Proof-of-Learning) né zkML.** La linea di ricerca Proof-of-Learning (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) è stata dimostrata falsificabile in scenari di addestramento reali (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)). zkML/opML (EZKL, Modulus, ORA) produce prove crittografiche o supportate economicamente per la validazione on-chain. backprop-trace non è crittografico, opera a singolo passaggio ed è destinato a essere utilizzato da esseri umani o revisori di sistemi di controllo (CI).
- **Non è un'attestazione della catena di fornitura.** [La firma dei modelli con Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev) e [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestano che *l'artefatto X è stato prodotto dal processo Y*. backprop-trace attesta che *questo aggiornamento può essere derivato matematicamente da questi fattori*. Sono strumenti complementari: un ML-BOM può fare riferimento a una ricevuta backprop-trace come predicato di coerenza interna.

## Modello di minaccia

`backprop-trace` è un verificatore deterministico: rientra nel suo ambito qualsiasi ricevuta che dovrebbe essere rifiutata ma viene accettata, inclusi bypass dello schema, avvelenamento da NaN/Infinity, divergenze nell'emissione canonica, violazioni dell'anti-circularità (il reconciliatore consulta `fixture_status` prima di eseguire i controlli), e discrepanze nel ricalcolo da parte del motore relative alle tracce del framework importato. Non rientra nel suo ambito l'affidabilità dell'esecuzione di training stessa, la correttezza del modello in fase di training, attacchi side-channel o attacchi temporali contro il processo di verifica, e qualsiasi aspetto al di là della decisione di accettazione della ricevuta. Il determinismo è limitato: l'output identico a livello di byte è garantito solo all'interno della stessa versione di `backprop-trace`, della stessa versione principale di Node.js (attualmente 22.x) e della stessa versione dello standard di emissione canonica. La riproducibilità tra motori diversi (Hermes, JSC, Bun-JSC) e tra diverse versioni principali di Node.js (24.x, 26.x, ...) non è prevista. Il verificatore si fida del formato della ricevuta e del contratto di emissione canonica; non si fida del produttore. Consultare [SECURITY.md](./SECURITY.md) per la cronologia delle divulgazioni, la classificazione della gravità e l'elenco completo.

## Installazione

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Bloccato alla versione Node 22.x (la determinazione di `Math.exp` di V8 fdlibm è fondamentale; vedere [`docs/computation-order.md`](./docs/computation-order.md)).

## Utilizzo della CLI

La versione 0.2 include quattro sottocomandi. Documentazione completa: [`docs/cli.md`](./docs/cli.md).

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

Flag comuni (vedere [`docs/cli.md`](./docs/cli.md)):

- `--out <file>` — scrive in un file invece di stdout
- `--json` — output JSON leggibile dalle macchine (per i sistemi CI)
- `--verbose`, `-V` — output diagnostico su stderr prima dell'esecuzione
- `--color=auto|never|always` — colore dell'output; rispetta la variabile `NO_COLOR`
- L'argomento file `-` legge da stdin (`reconcile receipt`, `validate`, `verify general`)

Codici di uscita: `0` successo · `1` errore di verifica · `2` errore di utilizzo o I/O · `3` argomento CLI non valido · `4` framework non implementato.

## Utilizzo come libreria

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

Importazioni di sottodirectory: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (topology-input), `./schema/framework-trace-0.1.0`.

## Fornisci la tua traccia di training

Il percorso di ingestione esterna v0.6 consente agli utenti di PyTorch / JAX / TensorFlow di verificare le proprie tracce di backprop a singolo passaggio rispetto alle stesse 16 regole, ma **oggi il file di supporto è creato manualmente**. Non esiste ancora un helper `pip install backprop-trace-pytorch`. Per creare un file di supporto:

1. Leggere lo schema [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) — definisce un contratto JSONL per un singolo passaggio di training (topologia + input + forward + gradienti + parametri_prima + parametri_dopo + provenienza).
2. Estrarre tali valori dal tuo passaggio di training (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape` — tutti espongono la numerica necessaria per ogni tensore).
3. Emettere il file di supporto come JSONL canonico (stringhe decimali, non float binari; vedere [`docs/canonical-emission.md`](./docs/canonical-emission.md)).
4. Eseguire `bp import pytorch <sidecar.jsonl>` (o `import jax` / `import tensorflow`).
5. L'importatore produce una **ricevuta in modalità observer**: le affermazioni del framework sono rappresentate come campi canonici; il motore `backprop-trace` ricalcola lo stesso passaggio ed esegue la **Regola 14** come controllo differenziale. Una discrepanza indica che il tuo estrattore ha mentito, o il tuo framework è cambiato, o c'è qualcosa di sbagliato nella traccia.

Questo è un flusso di lavoro reale oggi, ma è complesso. Consultare [Cosa non è incluso in questa versione (ancora)](#whats-not-in-this-version-yet) per la mancanza di un pacchetto helper dedicato.

È imposta la disciplina dei sottocomandi specifici per ogni framework: `bp import pytorch` rifiuta i file di supporto JAX e viceversa. Nessuna rilevazione automatica (nessuna dipendenza dal runtime del framework in questo pacchetto; per progettazione).

## Le 16 regole

| # | Regola |
|---|---|
| 0 | Sentinella di errore strutturale (a livello di schema) |
| 0.8 | Limiti di probabilità: output softmax compresi tra [0, 1] |
| 1 | Coerenza del segnale di errore di output |
| 2 | Contributo a valle e somma retropropagata |
| 3 | Coerenza del segnale di errore nascosto |
| 4 | Coerenza del gradiente di aggiornamento |
| 5 | Coerenza del valore di aggiornamento |
| 6 | Progressione dei pesi |
| 7 | Coerenza dello stato finale |
| 8 | Coerenza del riferimento di provenienza |
| 9 | Catena di parametri a più passaggi (`parameters_before[N]` = parametri precedenti `parameters_after[N-1]`) |
| 10 | Identità della traccia a più passaggi (ID di traccia `trace_id` condiviso + indice di passo `step_index` sequenziale) |
| 11 | Normalizzazione softmax (`sum(forward[output].out) == 1.0`) |
| 12 | Coerenza della formula di perdita (errore quadratico medio + rami cross-entropy-softmax) |
| 13 | Coerenza duale (decomposizione jacobiana softmax+CE; ATTIVATO solo quando `dual_form` è presente) |
| 14 | Differenziale di ricalcolo del motore (OBBLIGATORIO per le ricevute importate in modalità osservatore) |
| 15 | Base di esclusione richiesta (enum chiuso `EXTERNAL_TRUST_BASIS`, 4 valori) |
| 16 | Binding dell'hash di attestazione (ATTIVATO quando `attestor.signed_subject_digest` è presente) |

Dichiarazioni complete in [`docs/reconciliation.md`](./docs/reconciliation.md). Ogni regola è fornita con un file di test "negativo" corrispondente in `fixtures/bad/`, secondo la dottrina di Csmith.

## Ambito del determinismo

Cosa è contrattualmente vincolante nella matrice fissa (Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.7.x):

- Uguaglianza byte per byte di `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl`
- File "golden" esterni per i componenti aggiuntivi del framework inclusi: `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- L'ancora Mazur 2-2-2: `post_update_loss.total = 0.29102777369359933` (rispetto al valore ampiamente citato a valle di `0.291027924` — deriva di circa 1.5e-7; vedere `fixtures/mazur.published.json` per il registro)
- Riconciliazione per regola all'interno di una tolleranza ibrida (`atol = 1e-12`, `rtol = 1e-9` per i valori generati dal motore; più restrittiva quando la matematica è esatta)

Cosa NON è contrattualmente vincolante:

- Tra motori (Bun, Deno, browser) — implementazioni diverse di `Math.exp`
- Tra versioni principali di Node (24.x, 26.x, ...) — la porta V8 fdlibm potrebbe essere rivista
- Aggiornamenti minori arbitrari di V8 — ECMA-262 §21.3 lascia la precisione di `Math.exp` definita dall'implementazione
- Stabilità dei bit dei valori che passano attraverso `Math.exp` (sigmoid, tanh, softmax) tra le versioni di V8

Un test `Math.exp(-0.5)` viene eseguito in ogni cella CI come segnale di allarme precoce per la deriva di V8 fdlibm. Un errore significa "indagare il registro delle modifiche di V8", non "bug del motore".

## Cosa non è incluso in questa versione (ancora)

backprop-trace v0.7.0 è un **prodotto in fase di sviluppo (mid-v0)**. Il motore principale, il riconciliatore, il contratto di emissione canonica e il percorso di ingestione esterna sono reali e stabili. Tuttavia, diverse cose necessarie per un verificatore v1.0 non sono ancora presenti:

- **Ricevute con processo a più fasi in modalità "observer".** Attualmente, l'importazione esterna avviene in un'unica fase. Le vere sessioni di training richiedono migliaia di fasi. *Obiettivo per la versione 0.8.*
- **Ottimizzatori più avanzati rispetto al semplice SGD.** Non sono inclusi Adam, AdamW, momentum o weight decay. Nel 2026, la maggior parte dei training di machine learning utilizza Adam; l'utilizzo esclusivo di SGD rappresenta una limitazione significativa. *Obiettivo per la versione 0.9.*
- **Dimensione del batch.** Attualmente, è limitata a un singolo campione. I veri training in PyTorch/JAX/TF utilizzano batch. Un utente che desidera utilizzare il sistema con il proprio processo di training deve farlo manualmente, elaborando ogni campione separatamente. *Obiettivo per la versione 0.9.*
- **Strumenti di supporto per framework in tempo reale.** Attualmente, il componente aggiuntivo è creato manualmente; non è disponibile un pacchetto installabile tramite `pip install backprop-trace-pytorch`, né uno script pronto all'uso come `scripts/python-helpers/dump_pytorch_trace.py`. Il percorso per passare da "ho una fase di PyTorch" a "ho una ricevuta" è troppo lungo. *Obiettivo per la versione 0.10.*
- **Esempio pratico.** L'esempio di riferimento è l'esempio pedagogico Mazur 2-2-2. Un verificatore della versione 1.0 dovrebbe includere almeno un'architettura riconoscibile (una piccola CNN con forward e backward, un piccolo blocco transformer) come esempio predefinito. *Obiettivo per la versione 0.11.*
- **Validazione da parte degli utenti.** Non sono disponibili studi di caso di ricercatori esterni, corsi che utilizzano questo strumento per scopi didattici, né ingegneri della conformità che lo abbiano utilizzato per una verifica. *Obiettivo: prima di qualsiasi promozione alla versione 1.0.*
- **Determinismo su GPU.** Al di fuori dello scopo (e probabilmente lo rimarrà: le operazioni atomiche di cuDNN ConvolutionBackwardFilter impediscono la riproducibilità bit-per-bit tra le esecuzioni. [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La posizione del prodotto è: determinismo su CPU.

Se il tuo flusso di lavoro dipende da una di queste funzionalità, questa non è la versione giusta per te.

## Creazione di topologie personalizzate

Configura il motore tramite un file JSON: non sono necessarie modifiche al codice TypeScript.

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulta il file [`docs/authoring.md`](./docs/authoring.md) per una guida dettagliata: schemi di input e di output, confini di fiducia per le emissioni.

## A chi è rivolto

- **Autori di articoli sulla riproducibilità** (autori che inviano articoli a NeurIPS/ICML/CoLLAs; ricercatori consapevoli di REFORMS — Kapoor et al., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — possibilità di ottenere prove derivabili per ogni fase, che il revisore può eseguire in 30 secondi.
- **Didattica del machine learning** (Karpathy zero-to-hero, corsi universitari di deep learning, preparazione per colloqui di lavoro nel settore ML) — una singola fase di training definita, con tutti i fattori visibili, e un sistema di verifica che *rifiuta* configurazioni deliberatamente errate.
- **Ingegneri di framework/compilatori ML** (contributori di PyTorch/JAX/MLIR/XLA) — generazione di un tracciato noto e corretto per ogni operazione, da utilizzare per test di confronto con l'output di nuovi compilatori.
- **Ingegneri della conformità/verifica ML** (implementatori dell'articolo 10 della EU AI Act, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); utenti di SLSA-for-ML) — formato di ricevuta per ogni fase, inferiore alla firma del modello, allegato a una scheda del modello o a un pacchetto di verifica.

## Riferimenti:

- **Linee di ricerca relative alla "prova di apprendimento" (Proof-of-Learning)** — Jia et al. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) per l'idea strutturale; Fang et al. (EuroS&P 2023) per l'importante avvertenza che, nella pratica, la PoL può essere falsificata. Il meccanismo "backprop-trace" si concentra sull'aspetto del determinismo raggiungibile: verifica a livello di singola istruzione CPU.
- **REFORMS** — Kapoor et al. (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — una checklist di 32 elementi per la riproducibilità del machine learning; le "ricevute" che documentano ogni passaggio possono essere collegate agli elementi dal 24 al 30.
- **Principi di Csmith + CompCert** — Yang et al. (PLDI 2011) e Leroy (CACM 2009) — insiemi di dati avversari che dimostrano la validità di un verificatore; l'oracolo non deve consultare l'elemento che sta valutando.
- **Attestazione della catena di fornitura** — in-toto v1, SLSA Provenance v1.0, modello di trasparenza di Sigstore ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — le "ricevute" generate da "backprop-trace" possono essere incluse come soggetti di una dichiarazione DSSE.

NON zkML (nessuna succintezza crittografica). NON opML (nessun gioco di verifica delle frodi). NON un logger di metriche per il machine learning — backprop-trace scrive stringhe decimali invece di numeri in virgola mobile; più simile a Jest snapshots / Rust insta.

## La struttura legale

Da `docs/canonical-emission.md`:

> Il contratto precede il motore. La politica di formattazione precede la formattazione a runtime. Le ricevute errate precedono le ricevute corrette. La formattazione a runtime precede Mazur. Mazur precede le diagnostiche.

## Link

- [`docs/quickstart.md`](./docs/quickstart.md) — Guida introduttiva di cinque minuti
- [`docs/cli.md`](./docs/cli.md) — Riferimento al sottocomando `bp`
- [`docs/authoring.md`](./docs/authoring.md) — Come creare una topologia personalizzata
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Le 16 regole di riconciliazione
- [`docs/topology.md`](./docs/topology.md) — Creazione di topologie generali
- [`docs/multi-step.md`](./docs/multi-step.md) — "Ricevute" per l'addestramento a più passaggi (generate dal sistema)
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contratto di codifica a livello di byte
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordinamento IEEE 754; divieto di FMA; tolleranza ibrida; limite del determinismo
- [`docs/schema.md`](./docs/schema.md) — Guida dettagliata dello schema, campo per campo
- [`docs/attestation.md`](./docs/attestation.md) — Meccanismo di attestazione in-toto v1
- `fixtures/` — Esempi standard (Mazur, XOR, XOR con bias per neurone, iris, softmax-CE, XOR a più passaggi), esempi esterni con "sidecar" e modalità di osservazione (PyTorch, JAX, TensorFlow), esempi di "ricevute" errate create appositamente (una per ogni regola di riconciliazione)
- `schemas/` — Schema della "ricevuta" v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, schema dell'input della topologia v0.4.0, schema del tracciamento del framework v0.1.0 (tutti chiusi, annotati con "x-order", additivi)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Stack di regole, meccanismo anti-circularità, principio "le ricevute errate precedono quelle corrette"
- [`SECURITY.md`](./SECURITY.md) — Cosa costituisce una vulnerabilità per un verificatore
- [`CHANGELOG.md`](./CHANGELOG.md) — Cronologia delle versioni

## Licenza

MIT — vedere `LICENSE`.
