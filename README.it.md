<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

# @mcptoolshop/backprop-trace

Motore di tracciamento deterministico per l'addestramento: genera ricevute JSONL standard per ogni singolo passaggio di backpropagation, verificate da un sistema di controllo (reconciler) con 8 regole (tutte le 8 regole implementate nella versione 0.2).

## Perché backprop-trace?

Se insegni, esegui audit o verifichi l'addestramento di reti neurali, hai bisogno di un modo per affermare che "questa traccia è coerente". backprop-trace genera ricevute standard a livello di byte per ogni singolo passaggio di backpropagation e un sistema di controllo che ricava ogni valore dai fattori specificati. La versione 0.1 include l'esempio Mazur 2-2-2, l'esempio di backpropagation pedagogico più citato sul web, come baseline di regressione a livello di byte, oltre a un esempio "difettoso" che dimostra come il verificatore rifiuti ciò che dovrebbe rifiutare.

Questo **non** è un logger di metriche per il machine learning (utilizza MLflow / W&B / TensorBoard per questo). È un verificatore di traccia strutturale, derivato dalla linea di ricerca Proof-of-Learning (Jia et al. IEEE S&P 2021), focalizzato su esempi pedagogici a singolo passaggio, piuttosto che sull'intero processo di addestramento.

## Guida rapida (30 secondi)

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

Per una guida più dettagliata, consulta [`docs/quickstart.md`](./docs/quickstart.md); per la documentazione della CLI, [`docs/cli.md`](./docs/cli.md); per la procedura di attestazione, [`docs/attestation.md`](./docs/attestation.md).

## Installazione

```
pnpm add @mcptoolshop/backprop-trace
```

Oppure con npm:

```
npm install @mcptoolshop/backprop-trace
```

## Utilizzo della CLI

La versione 0.2 include quattro sottocomandi. Documentazione completa: [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

Flag comuni (consulta [`docs/cli.md`](./docs/cli.md) per la documentazione completa):

- `--json` — output JSON leggibile dalle macchine (per i sistemi CI).
- `--verbose`, `-V` — messaggi diagnostici su stderr prima dell'esecuzione.
- `--color=auto|never|always` — output colorato; rispetta la variabile d'ambiente `NO_COLOR`.
- L'argomento file `-` legge da stdin (`reconcile receipt`, `validate`, `verify mazur`).

Codici di uscita: 0 successo, 1 errore di verifica, 2 errore di I/O / input non valido, 3 argomento CLI non valido.

I comandi `bp --version` e `bp --help` funzionano senza un sottocomando; `bp <sottocomando> --help` mostra l'utilizzo specifico del sottocomando.

## Utilizzo come libreria

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

Consulta [`docs/attestation.md`](./docs/attestation.md) per la mappatura in-toto v1.

Le importazioni di sottodirectory sono esportate (`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`).

## Di cosa si tratta

Un *verificatore di traccia strutturale* con codifica a livello di byte standard. La ricevuta è il contratto; il sistema di controllo verifica ogni affermazione contenuta nella ricevuta e verifica la coerenza dei calcoli.

Riferimenti:

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) per il principio "le ricevute errate precedono quelle corrette".

NON zkML (nessuna succintezza crittografica). NON opML (nessun gioco di verifica delle frodi). NON un logger di metriche per il machine learning — backprop-trace scrive stringhe decimali invece di numeri in virgola mobile; più simile a Jest snapshots / Rust insta.

## Ambito del determinismo

Fiducia del tracciamento a 9 cifre significative all'interno dell'intervallo ULP di V8/Node 22. I valori del motore fissati presuppongono numeri in virgola mobile IEEE 754 scalari su V8.

La portabilità tra motori (Hermes, JSC, Bun-JSC) **non è testata**. Il valore di riferimento ampiamente citato `0.291027924` differisce dal valore del motore `0.29102777369359933` di circa 1.5e-7; consulta `fixtures/mazur.published.json` per il registro delle variazioni.

La versione 0.1 è fissata a Node 22.x.

## Le otto regole

1. Coerenza del segnale di errore.
2. Contributo a valle e somma retropropagata.
3. Coerenza del segnale di errore nascosto.
4. Coerenza del gradiente di aggiornamento.
5. Coerenza del valore di aggiornamento.
6. Evoluzione dei pesi.
7. Coerenza dello stato finale.
8. Coerenza del riferimento di provenienza.

Tutte e 8 le regole sono implementate in v0.2 (la regola 4 era stata introdotta originariamente in v0.1). Le dichiarazioni complete delle regole sono disponibili in [`docs/reconciliation.md`](./docs/reconciliation.md); ogni regola è fornita con un file di test `fixtures/bad/mazur.bad-<kind>.jsonl` appositamente creato per violare le regole, secondo la filosofia di Csmith.

## La struttura legale

Da `docs/canonical-emission.md`:

> Il contratto precede il motore. La politica di formattazione precede la formattazione a runtime. Le ricevute errate precedono le ricevute corrette. La formattazione a runtime precede Mazur. Mazur precede le diagnostiche.

## Ambito di v0.2

- Solo topologia Mazur 2-2-2.
- Solo addestramento a singolo passo.
- Solo funzione di attivazione sigmoide e funzione di perdita half-squared-error (MSE).
- Bias per ogni livello.
- Ottimizzatore SGD (senza momentum, senza Adam, senza weight decay).
- Solo CPU (nessuna garanzia di determinismo su GPU).
- Solo V8 / Node 22.x.

L'addestramento a più passaggi, le topologie generalizzate, le funzioni di attivazione/perdita alternative e gli ottimizzatori più avanzati sono previsti per v0.3+ (vedere [`CHANGELOG.md`](./CHANGELOG.md) per le funzionalità incluse in v0.2).

## Link

- [`docs/quickstart.md`](./docs/quickstart.md) — Guida introduttiva di cinque minuti.
- [`docs/cli.md`](./docs/cli.md) — Riferimento del sottocomando `bp` (v0.2+).
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Le otto regole di riconciliazione.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contratto di codifica a livello di byte.
- [`docs/computation-order.md`](./docs/computation-order.md) — Regole di ordinamento IEEE 754; divieto di FMA.
- [`docs/schema.md`](./docs/schema.md) — Descrizione dettagliata di ogni campo dello schema della ricevuta.
- [`docs/attestation.md`](./docs/attestation.md) — Meccanismo di attestazione in-toto v1 (v0.2+).
- `fixtures/` — Ledger "gold standard" canonico, policy di formattazione derivata manualmente, otto ricevute "bad-* " appositamente create per violare le regole (una per ogni regola di riconciliazione).
- `schemas/receipt.v0.1.0.json` — Schema JSON della ricevuta (definito, con annotazioni `x-order` che guidano l'emissione canonica).
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — La struttura legale, il meccanismo anti-circularità, il principio "le ricevute errate precedono le ricevute corrette".
- [`SECURITY.md`](./SECURITY.md) — Cosa costituisce una vulnerabilità per un verificatore.

## Licenza

MIT — vedere `LICENSE`.
