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

Un verificatore deterministico con 26 regole per le fasi di addestramento delle reti neurali. Si fornisce in input una registrazione che elenca tutti i fattori che hanno contribuito a un singolo aggiornamento del gradiente; il sistema di riconciliazione ricalcola ogni affermazione e rifiuta in caso di incongruenza. Nel contesto della linea Csmith/CompCert, si applica il principio secondo cui *"l'oracolo non deve consultare l'artefatto che sta valutando"*.

> **v1.0.0 — Solo CPU, deterministico.** Il verificatore copre SGD, Adam, AdamW, SGD-momentum (classico/Nesterov/smorzamento) e **SGD con decadimento del peso L2 accoppiato**, attraverso 26 regole di riconciliazione. Gli strumenti live per **PyTorch e JAX** estraggono un effettivo passo di addestramento in una registrazione verificabile: solo a scopo di osservazione, la [Regola 14](./docs/reconciliation.md) è l'autorità su ogni componente aggiuntivo importato. 940 test deterministici; limiti di tolleranza definiti dal verificatore; meccanismo anti-circolarità. Consultare [`docs/live-helpers.md`](./docs/live-helpers.md) prima dell'uso in produzione e il [CHANGELOG](./CHANGELOG.md) per la cronologia delle versioni.

## Avvio rapido di 30 secondi

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

Il metodo Mazur 2-2-2 è l'esempio più citato di retropropagazione in un singolo passaggio disponibile sul web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Ogni numero al suo interno può essere derivato manualmente.

## Cos'è questo strumento

Un verificatore di correttezza numerica per un singolo passo di addestramento. Il sistema di riconciliazione esamina 26 regole che ricalcolano ogni affermazione a partire dai fattori specificati. Se una qualsiasi regola non è coerente entro la tolleranza ibrida (`atol + rtol`), la registrazione viene rifiutata. Le regole per più passaggi (Regole 9 + 10), i batch (Regole 18 + 19), le ricorrenze del momento di Adam (Regole 22-24), la ricorrenza del momentum SGD (Regole 20 + 21a/21b/21c + 25 + 26) e il ricalcolo differenziale sul motore per le tracce importate (Regola 14) coprono gli aspetti rilevanti per l'uso in produzione.

Non convalida l'intero processo di addestramento, non dimostra che il modello è corretto e non sostituisce uno strumento di monitoraggio degli esperimenti. Dimostra che ogni passo registrato è matematicamente coerente e che la catena è integra. I dati avversari dimostrano l'efficacia di un verificatore ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)): ogni regola viene fornita con un esempio negativo associato, presente in [`fixtures/bad/`](./fixtures/bad), che il verificatore deve rifiutare *prima* di leggere qualsiasi metadato `fixture_status`.

## Strumento live per PyTorch (v0.10+)

Unico file Python controllabile. Non è previsto un pacchetto pip: copiarlo nel repository, leggerlo ed eseguirlo.

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

Lo strumento genera un componente aggiuntivo `framework-trace.v0.7.0` con un blocco "helper" a scopo di analisi forense (nome, versione, hash della sorgente, versione del framework, ambiente di runtime, timestamp dell'estrazione). Il blocco **non è una credenziale**: la Regola 14 (ricalcolo differenziale sul motore) è l'autorità su ogni componente aggiuntivo generato dallo strumento, indipendentemente da quanto dichiarato dallo stesso. Un `source_hash` contraffatto/errato/mancante NON aggira la Regola 14. Consultare [`docs/live-helpers.md`](./docs/live-helpers.md) per la dichiarazione sui limiti di fiducia, l'elenco degli elementi proibiti, il catalogo avversario con 9 esempi e il contratto relativo all'assenza di distribuzione tramite pip.

**Supportato**: PyTorch SGD + Adam + AdamW + sgd_momentum (classico/Nesterov/smorzamento) + **SGD con decadimento del peso L2 accoppiato**, con l'inversione del segno `momentum_buffer` da ascensione a discesa, come indicato in [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099). Priorità alla CPU. Singolo e più passaggi. Uno strumento live parallelo per JAX (`scripts/extract/jax.py`) copre SGD + Adam con un limite di fiducia più rigoroso: include un digest `jax.make_jaxpr(jax.grad(loss))` nel blocco forense (il grafico del gradiente ispezionabile che PyTorch eager non offre) e si rifiuta di eseguire senza `jax_enable_x64` + CPU. Consultare [`docs/live-helpers.md`](./docs/live-helpers.md).
**Non supportato**: AMP/autocast, CUDA/MPS/XLA, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologie con più livelli nascosti. I componenti aggiuntivi creati manualmente per questi framework/ottimizzatori continuano a funzionare tramite il percorso standard `bp import`.

## Cos'è questo strumento (non)

- **Non è uno strumento di monitoraggio degli esperimenti.** Utilizzare [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard): questi strumenti registrano le affermazioni; la retropropagazione ricalcola se la matematica è internamente coerente.
- **Non è una prova di apprendimento (Proof-of-Learning) o zkML.** È stato dimostrato che [PoL](https://arxiv.org/abs/2103.05633) può essere falsificato in un addestramento reale ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produce prove crittografiche. La retropropagazione non è crittografica, si applica a un singolo passaggio e il pubblico di riferimento è un essere umano o un revisore CI.
- **Non è una verifica della catena di fornitura.** [Sigstore model-signing](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestano la provenienza della pipeline; la retropropagazione attesta la coerenza numerica. Un ML-BOM può fare riferimento a una registrazione di retropropagazione come predicato di coerenza interna.

## Modello delle minacce

Inclusi: qualsiasi registrazione che dovrebbe essere rifiutata ma viene accettata (bypass dello schema, avvelenamento con NaN/Infinito, divergenza nell'emissione canonica, violazioni dell'anti-circolarità, disaccordo nel ricalcolo sul motore per i componenti aggiuntivi importati). Esclusi: affidabilità del processo di addestramento stesso, attacchi a canali laterali al processo di verifica. Il determinismo è limitato: l'output identico in byte è garantito solo con la stessa versione della retropropagazione, Node.js 22.x e le stesse specifiche per l'emissione canonica. Consultare [SECURITY.md](./SECURITY.md) per l'elenco completo e la cronologia delle divulgazioni.

## Installazione

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fissato a Node 22.x (il determinismo di V8 fdlibm `Math.exp` è fondamentale: vedere [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI

Riferimento completo: [`docs/cli.md`](./docs/cli.md).

| Verbo | Scopo |
|---|---|
| `bp reconcile receipt <file>` | Esegue tutte le 26 regole; esce con codice 1 in caso di primo errore |
| `bp verify mazur` | Controllo completo sul componente aggiuntivo Mazur fornito. |
| `bp verify general <file>` | Gate generalizzato (v0.2+; risultati: XOR, iris, softmax+CE, modalità osservatore) |
| `bp verify multi <file.jsonl>` | JSONL con più record + regole tra i record (9/10) |
| `bp generate {mazur,xor,iris}` | Rieseguire il motore specificato e generare byte canonici |
| `bp generate from-config <file>` | Rieseguire il motore a partire da una topologia e un file di input in formato JSON |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | Scrivere una configurazione di input iniziale |
| `bp validate-input <file>` | Convalidare uno schema per una topologia e un file di input |
| `bp validate <file>` | Convalidare uno schema per un risultato (rileva automaticamente le versioni da v0.1 a v0.7) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Importare la traccia di un framework esterno |
| `bp examples {pytorch,jax} [--print]` | Stampare il percorso (o visualizzare il contenuto) del modulo PyTorch/JAX attivo incluso nel pacchetto |

Flag comuni: `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, argomento file `-` = stdin. Codici di uscita: `0` (successo), `1` (fallimento della verifica), `2` (utilizzo/I-O), `3` (argomento CLI non valido), `4` (framework non implementato).

## Libreria

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

> **Quale gate dimostra cosa.** `reconcileReceipt` dimostra che la matematica del risultato è
> *internamente coerente* (le 26 regole derivano nuovamente ogni affermazione dai fattori stessi del risultato). Per un risultato di **provenienza sconosciuta**, associarlo al gate `engine-reproduce` — `verifyEngineReproduces` (o `bp verify general`), che riesegue il motore deterministico a partire dagli input del risultato e confronta i campi. Questo secondo gate è ciò che chiude l'ambito dell'anti-circularità: la sola coerenza interna non può rilevare un risultato esterno che è stato rinominato come se fosse stato generato dal motore, perché nessuna regola specifica per ogni risultato deriva nuovamente il passaggio in avanti per un risultato generato dal motore. Le importazioni in modalità osservatore (`importPytorchSidecar`) eseguono automaticamente la differenza `engine-reproduce` (Regola 14); `bp verify` esegue sempre entrambi i gate.

Importazioni di sottopercorsi: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, più la famiglia di schemi `./schema/...`.

## Le 26 regole

Dichiarazioni complete + casi di test avversari: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Regola |
|---|---|
| 0 | Sentinella per guasti strutturali (a livello di schema) |
| 0.8 | Limiti di probabilità: output softmax in [0, 1] |
| 1-4 | Segnali di errore (output, downstream, nascosti) + coerenza dell'aggiornamento del gradiente |
| 5-7 | Valore di aggiornamento, progressione dei pesi, stato finale (ramo AdamW sulle Regole 6/7 per il decadimento del peso disaccoppiato) |
| 8 | Coerenza del riferimento della provenienza |
| 9-10 | Catena di parametri multi-step + identità della traccia |
| 11-13 | Normalizzazione softmax + formula di perdita + forma duale (GATED) |
| 14 | Differenziale di ricalcolo del motore (OBBLIGATORIO per le importazioni in modalità osservatore) |
| 15-17 | Base di salto + associazione digest firmata + associazione della radice del pacchetto (GATED) |
| 18-19 | Coerenza della riduzione batch + coerenza dell'insieme di campioni (GATED) |
| 20 | Forma dello stato dell'ottimizzatore (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **SGD con momento in stile PyTorch**: 21a ricorrenza del buffer + 21b direzione effettiva + 21c aggiornamento dei parametri |
| 22-24 | Ricorrenze del momento Adam + correzione della distorsione + aggiornamento dei parametri (epsilon FUORI dalla radice quadrata) |
| 25-26 | Catena di stati dell'ottimizzatore multi-step + costanza della configurazione dell'ottimizzatore |

## Ambito del determinismo

Contrattuale su Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.12.x: valori di riferimento byte per byte (Mazur, XOR, iris, softmax+CE, multi-step, batch, sidecar esterni); l'ancora Mazur `post_update_loss.total = 0.29102777369359933`; riconciliazione per ogni regola all'interno di `atol=1e-12`, `rtol=1e-9` per i risultati generati dal motore.

NON contrattuale: tra motori (Bun, Deno, browser); tra versioni principali di Node (24.x+); modifiche arbitrarie della versione minore di V8. Un "canarino" `Math.exp(-0.5)` viene attivato su ogni cella CI come segnale di deriva fdlibm di V8.

## Cosa non è presente in questa versione (ancora)

La v1.0.0 copre l'angolo deterministico-CPU dall'inizio alla fine: il motore, il riconciliatore, il contratto di emissione canonica, il percorso di importazione esterno, i moduli PyTorch **e** JAX attivi, gli ottimizzatori della famiglia SGD inclusi il decadimento del peso L2 accoppiato, un caso di test "eroico" riconoscibile e un pacchetto di conformità funzionante [qui](./docs/compliance.md). La tabella di marcia qui sotto indica cosa **non è ancora coperto deliberatamente** — ordinato per utilizzo × fattibilità della verifica, ciascuno subordinato a un ricalcolo CPU in forma chiusa che il riconciliatore può effettivamente gestire:

- **NAdam (+ eventualmente RAdam)**: varianti economiche di Adam. Quindi, **verifica dello schema di apprendimento**, che si combina con ogni ottimizzatore. *Successivamente.*
- **AMSGrad / clipping del gradiente globale / LRs per gruppo / Lion**: ciascuno attivato tramite un'estensione di "ricevuta/riconciliazione". *Più tardi.*
- **Topologie Conv / multi-strato nascosto**: il motore è una rete densa a singolo strato nascosto; l'elemento principale è un classificatore denso ReLU→softmax riconoscibile. Conv introduce un ordinamento FP con kernel fusi che combatte la determinazione bit per bit (vedere GPU di seguito). *Probabilmente al di fuori del contesto CPU-deterministico.*
- **Tracce eterogenee multi-framework**: solo pacchetti a singolo framework; le sequenze multi-framework non sono supportate. *Potrebbe rimanere al di fuori dell'ambito.*
- **Dimensioni batch eterogenee tra i passaggi**: dimensione del batch fissa per ogni sequenza. *Potrebbe rimanere al di fuori dell'ambito.*
- **Gradienti per campione nelle ricevute raggruppate**: solo gradienti ridotti oggi; la decomposizione per campione è utile per le verifiche di influenza, ma non è ancora disponibile. *Più tardi.*
- **Vincolo sull'identità del produttore nelle tracce multi-passaggio**: la regola 17 rileva i fallimenti dell'integrità del pacchetto, non l'autenticità del produttore. Combinare con la regola 16 / Sigstore / attestazione esterna. Superficie operativa, non integrata.
- **GPU / determinismo bit per bit con kernel fusi**: al di fuori dell'ambito e permanente. La non associatività in virgola mobile rende impossibile ottenere una precisione a livello di bit tra i kernel fusi/paralleli ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148); atomiche cuDNN ConvolutionBackwardFilter per [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). Il risultato è l'ambito CPU deterministico.

Se il tuo flusso di lavoro dipende da uno di questi, questa non è ancora la versione giusta per te.

## Crea una topologia personalizzata

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consulta [`docs/authoring.md`](./docs/authoring.md): schemi di input rispetto a schemi di ricevuta, limite di affidabilità dell'emissione canonica.

## Dove si inserisce questo

- **Autori di articoli che danno priorità alla riproducibilità** (NeurIPS/ICML/CoLLAs; consapevoli di [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)): evidenza derivabile per ogni passaggio, che il revisore esegue in 30 secondi.
- **Didattica sull'apprendimento automatico** (Karpathy da zero all'eroe, corsi universitari di DL, preparazione per i colloqui): un singolo passaggio di addestramento con tutti i fattori visibili e un riconciliatore che *rifiuta* deliberatamente gli elementi difettosi.
- **Ingegneri di framework / compilatori di apprendimento automatico** (collaboratori di PyTorch / JAX / MLIR / XLA): traccia per operazione nota come funzionante per il test differenziale.
- **Ingegneri di conformità / audit dell'apprendimento automatico** ([Allegato IV §2(g) del Regolamento UE sull'IA, log di validazione/test + Articolo 15 sulla robustezza](https://artificialintelligenceact.eu/annex/4/); SLSA per l'apprendimento automatico): una ricevuta per ogni passaggio come record di test verificabile, datato e firmabile digitalmente al di sotto della firma del modello. Consulta il pacchetto di conformità completo [./docs/compliance.md]( ./docs/compliance.md) (e l'ambito onesto: le ricevute attestano la *matematica*, non la governance dei dati).

## La pila delle leggi

Da `docs/canonical-emission.md`:

> Il contratto precede il motore. La politica del formattatore precede la formattazione in fase di esecuzione. Le ricevute errate precedono le ricevute corrette. La formattazione in fase di esecuzione precede Mazur. Mazur precede la diagnostica.

## Collegamenti

- [`docs/quickstart.md`](./docs/quickstart.md): guida rapida di cinque minuti
- [`docs/cli.md`](./docs/cli.md): riferimento al sottocomando `bp`
- [`docs/live-helpers.md`](./docs/live-helpers.md): helper PyTorch live v0.10: flusso di lavoro, limite di affidabilità, catalogo avversario, motivazione per l'assenza di pip
- [`docs/authoring.md`](./docs/authoring.md): crea una topologia personalizzata
- [`docs/reconciliation.md`](./docs/reconciliation.md): le 26 regole del riconciliatore nella loro interezza
- [`docs/topology.md`](./docs/topology.md): creazione di topologie generali
- [`docs/multi-step.md`](./docs/multi-step.md): ricevute di addestramento multi-passaggio
- [`docs/canonical-emission.md`](./docs/canonical-emission.md): contratto di codifica a livello di byte
- [`docs/computation-order.md`](./docs/computation-order.md): ordinamento IEEE 754; divieto di FMA; limite del determinismo
- [`docs/schema.md`](./docs/schema.md): analisi dello schema campo per campo
- [`docs/attestation.md`](./docs/attestation.md): punto di attestazione in-toto v1
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): meccanismo anti-circolarità; dottrina "le ricevute errate precedono quelle corrette"
- [`SECURITY.md`](./SECURITY.md): cosa conta come vulnerabilità per un verificatore
- [`CHANGELOG.md`](./CHANGELOG.md): cronologia versione per versione

## Licenza

MIT: consulta [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
