<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

Un vérificateur déterministe de traçabilité structurelle pour les étapes d'entraînement uniques des réseaux neuronaux : un outil de réconciliation basé sur 16 règles qui redérive les gradients, les signaux et les mises à jour des paramètres à partir de facteurs nommés, et génère des reçus canoniques au format JSONL. Dans la lignée de Csmith/CompCert, qui suit le principe selon lequel *"l'oracle ne doit pas consulter l'artefact qu'il juge."*

> **Statut : version bêta (v0.7.0).** Le moteur principal et l'outil de réconciliation sont fonctionnels et prêts à être utilisés. Il prend en charge les entraînements par étape unique, uniquement sur CPU, uniquement avec la descente de gradient stochastique (SGD), et pour un seul échantillon. Les traces de frameworks externes sont actuellement des modules complémentaires créés manuellement. Consultez la section [Ce qui ne fait pas partie de cette version (pour l'instant)](#whats-not-in-this-version-yet) avant de l'utiliser pour des travaux en production.

## Démarrage rapide en 30 secondes

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

Mazur 2-2-2 est la description la plus citée d'une étape de rétropropagation sur le web (Matt Mazur, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). C'est un exemple de référence car chaque nombre qu'il contient peut être dérivé manuellement. Pour votre propre trace, consultez [Fournissez votre propre trace d'entraînement](#bring-your-own-training-trace).

## Ce qu'est cet outil

backprop-trace est un vérificateur de correction numérique pour *une seule* étape d'entraînement d'un réseau neuronal. Vous lui fournissez un reçu — un enregistrement JSONL qui nomme chaque facteur ayant contribué à une seule mise à jour du gradient — et l'outil de réconciliation applique 16 règles qui redérivent chaque affirmation à partir des facteurs nommés. Si une règle ne correspond pas dans une plage de tolérance hybride (`atol + rtol`, forme maximale symétrique), le reçu est rejeté.

Les fondements théoriques sont Csmith (Yang, Chen, Eide, Regehr — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) et CompCert (Leroy, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)) : les corpus adverses prouvent l'existence d'un vérificateur, et les tests réussis ne suffisent pas. Chaque règle de réconciliation est accompagnée d'un exemple défectueux intentionnellement dans le répertoire [`fixtures/bad/`](./fixtures/bad) que le vérificateur doit rejeter *avant* de lire les métadonnées du cycle de vie `fixture_status`. Cette discipline anti-circularité — l'oracle ne doit pas consulter l'artefact qu'il juge — est une propriété essentielle.

## Ce que cela n'est pas

- **Ce n'est pas un outil de suivi des expériences.** Si vous souhaitez des courbes de perte, des tableaux de bord ou un stockage des exécutions à long terme, utilisez [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai) ou [TensorBoard](https://www.tensorflow.org/tensorboard). Ces outils enregistrent ce que le formateur prétend qu'il s'est passé. backprop-trace redérive si les calculs sont cohérents en interne. Complémentaire, pas redondant.
- **Ce n'est pas une preuve d'apprentissage (Proof-of-Learning) ni une cryptographie de l'apprentissage automatique (zkML).** La ligne de PoL (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) a été démontrée comme pouvant être falsifiée lors d'entraînements réels (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)). zkML/opML (EZKL, Modulus, ORA) produit des preuves cryptographiques ou économiquement garanties pour les transactions en chaîne sécurisées. backprop-trace n'est pas cryptographique, ne concerne qu'une seule étape, et est destiné à un public humain ou à un examinateur de CI.
- **Ce n'est pas une attestation de la chaîne d'approvisionnement.** [La signature de modèles Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev) et [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestent que *l'artefact X a été produit par le pipeline Y*. backprop-trace atteste que *cette mise à jour peut être dérivée mathématiquement à partir de ces facteurs*. Complémentaire : un ML-BOM peut référencer un reçu backprop-trace comme un prédicat de cohérence interne.

## Modèle de menace

`backprop-trace` est un vérificateur déterministe : il couvre tout reçu qui devrait être rejeté mais qui est accepté, notamment les contournements de schéma, les attaques par injection de NaN/Infinity, les divergences d'émission canonique, les violations de circularité (le réconciliateur consultant `fixture_status` avant d'effectuer les vérifications), et les désaccords de recalcul du moteur concernant les traces de framework importées. Ce qui n'est pas couvert inclut la fiabilité de l'exécution de l'entraînement elle-même, la correction du modèle en cours d'entraînement, les attaques par canaux cachés ou les attaques temporelles contre le processus de vérification, et tout ce qui dépasse la décision d'acceptation du reçu. Le déterminisme est limité : la sortie identique au niveau des octets est garantie uniquement pour la même version de `backprop-trace`, la même version majeure de Node.js (actuellement 22.x) et la même version de spécification d'émission canonique. La reproduction entre différents moteurs (Hermes, JSC, Bun-JSC) et entre différentes versions majeures de Node.js (24.x, 26.x, etc.) n'est pas un objectif. Le vérificateur fait confiance au format du reçu et au contrat d'émission canonique ; il ne fait pas confiance au producteur. Consultez [SECURITY.md](./SECURITY.md) pour connaître le calendrier des divulgations, la grille de gravité et l'énumération complète.

## Installation

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Fixé à Node 22.x (le déterminisme de `Math.exp` de V8 fdlibm est essentiel - voir [`docs/computation-order.md`](./docs/computation-order.md)).

## Utilisation de l'interface en ligne de commande

La version 0.2 inclut quatre sous-commandes. Référence complète : [`docs/cli.md`](./docs/cli.md).

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

Options courantes (voir [`docs/cli.md`](./docs/cli.md)) :

- `--out <file>` : écrit dans un fichier au lieu de la sortie standard.
- `--json` : sortie JSON lisible par machine (pour les consommateurs CI).
- `--verbose`, `-V` : messages de diagnostic sur la sortie d'erreur standard avant l'exécution.
- `--color=auto|never|always` : couleur de la sortie ; respecte `NO_COLOR`.
- L'argument de fichier `-` lit à partir de l'entrée standard (`reconcile receipt`, `validate`, `verify general`).

Codes de sortie : `0` succès · `1` échec de la vérification · `2` erreur d'utilisation ou d'E/S · `3` argument de ligne de commande non valide · `4` framework non implémenté.

## Utilisation en tant que bibliothèque

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

Importations de sous-répertoires : `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (topology-input), `./schema/framework-trace-0.1.0`.

## Fournissez votre propre trace d'entraînement

Le chemin `external-ingestion` v0.6 permet aux utilisateurs de PyTorch / JAX / TensorFlow de vérifier leurs propres traces de rétropropagation en une seule étape par rapport aux 16 règles, mais **aujourd'hui, le fichier auxiliaire est créé manuellement**. Il n'existe pas encore d'outil `pip install backprop-trace-pytorch`. Pour créer un fichier auxiliaire :

1. Lisez le schéma [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) - il définit un contrat JSONL pour une étape d'entraînement (topologie + entrée + propagation avant + gradients + paramètres_avant + paramètres_après + provenance).
2. Extrayez ces valeurs de votre étape d'entraînement (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape` - tous exposent les valeurs numériques par tenseur nécessaires).
3. Émettez le fichier auxiliaire au format JSONL canonique (chaînes décimales, pas des flottants binaires - voir [`docs/canonical-emission.md`](./docs/canonical-emission.md)).
4. Exécutez `bp import pytorch <sidecar.jsonl>` (ou `import jax` / `import tensorflow`).
5. L'importateur produit un **réçu en mode observateur** : les affirmations du framework sont stockées sous forme de champs canoniques ; le moteur `backprop-trace` recalcule la même étape et exécute la **règle 14** comme vérification différentielle. Un désaccord indique que votre extracteur a menti, ou que votre framework a dérivé, ou qu'il y a un problème avec la trace.

Il s'agit d'un flux de travail réel aujourd'hui, mais il est complexe. Consultez [Ce qui n'est pas inclus dans cette version (encore)](#whats-not-in-this-version-yet) pour connaître le manque d'un package d'aide intégré.

La discipline des sous-commandes spécifiques à chaque framework est appliquée : `bp import pytorch` rejette les fichiers auxiliaires JAX et vice versa. Aucune détection automatique (pas de dépendance d'exécution du framework en direct dans ce package - par conception).

## Les 16 règles

| # | Règle |
|---|---|
| 0 | Sentinelle de défaillance structurelle (au niveau du schéma) |
| 0.8 | Limites de probabilité : les sorties softmax doivent être comprises entre [0, 1] |
| 1 | Cohérence du signal d'erreur de sortie |
| 2 | Contribution en aval et somme rétro-propagée |
| 3 | Cohérence du signal d'erreur caché |
| 4 | Cohérence du gradient de mise à jour |
| 5 | Cohérence de la valeur de mise à jour |
| 6 | Progression des poids |
| 7 | Cohérence de l'état final |
| 8 | Cohérence de la référence d'origine |
| 9 | Chaîne de paramètres en plusieurs étapes (`parameters_before[N]` = valeur précédente de `parameters_after[N-1]`) |
| 10 | Identité de la trace en plusieurs étapes (ID de trace partagé + index d'étape séquentiel) |
| 11 | Normalisation softmax (`sum(forward[output].out) == 1.0`) |
| 12 | Cohérence de la formule de perte (erreur quadratique + branches d'entropie croisée softmax) |
| 13 | Cohérence duale (décomposition jacobienne softmax+CE ; GATED — ne s'active que si `dual_form` est présent) |
| 14 | Calcul différentiel de ré-exécution du moteur (OBLIGATOIRE pour les reçus importés en mode observateur) |
| 15 | Base de saut requise (énumération fermée `EXTERNAL_TRUST_BASIS`, 4 valeurs) |
| 16 | Liaison de l'empreinte d'attestation (GATED — s'active lorsque `attestor.signed_subject_digest` est présent) |

Déclarations complètes dans [`docs/reconciliation.md`](./docs/reconciliation.md). Chaque règle est accompagnée d'un fichier de test défectueux correspondant dans `fixtures/bad/`, conformément à la doctrine Csmith.

## Portée du déterminisme

Ce qui est contractuel pour la matrice fixe (Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.7.x) :

- Égalité des octets pour `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl`
- Fichiers "golden" externes identiques pour les modules complémentaires du framework : `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- L'ancre Mazur 2-2-2 : `post_update_loss.total = 0.29102777369359933` (par rapport à la valeur largement citée en aval de `0.291027924` — dérive d'environ 1,5e-7 ; voir `fixtures/mazur.published.json` pour le registre)
- Réconciliation par règle avec une tolérance hybride (`atol = 1e-12`, `rtol = 1e-9` pour les valeurs générées par le moteur ; plus stricte lorsque les calculs sont exacts)

Ce qui N'EST PAS contractuel :

- Entre les moteurs (Bun, Deno, navigateurs) — différentes implémentations de `Math.exp`
- Entre les versions principales de Node (24.x, 26.x, ...) — le port V8 fdlibm peut être révisé
- Modifications mineures arbitraires de V8 — ECMA-262 §21.3 laisse la précision de `Math.exp` définie par l'implémentation
- Stabilité des bits des valeurs qui transitent par `Math.exp` (sigmoïde, tangente hyperbolique, softmax) entre les versions de V8

Un test `Math.exp(-0.5)` est exécuté sur chaque cellule CI comme une alarme précoce pour détecter les dérives de V8 fdlibm. Une erreur signifie "examiner le journal des modifications de V8", et non "bug du moteur".

## Ce qui n'est pas inclus dans cette version (pour l'instant)

backprop-trace v0.7.0 est un **produit en phase de développement (mid-v0)**. Le moteur principal, le réconciliateur, le contrat d'émission canonique et le chemin d'ingestion externe sont réels et stables. Cependant, plusieurs éléments nécessaires pour un vérificateur v1.0 ne sont pas encore inclus :

- **Relevés de suivi multi-étapes.** L'ingestion externe est actuellement une étape unique. Les entraînements réels comportent des milliers d'étapes. *Objectif prochain : v0.8.*
- **Optimiseurs au-delà de SGD standard.** Pas d'Adam, AdamW, momentum ou décroissance du poids. L'entraînement réel en machine learning en 2026 utilise massivement Adam ; l'utilisation exclusive de SGD est une réelle limitation. *Objectif de la feuille de route : v0.9.*
- **Dimension du lot (batch).** Actuellement, un seul échantillon. L'entraînement réel avec PyTorch/JAX/TF utilise des lots. Un utilisateur ne peut pas importer ce système pour son propre entraînement sans dérouler manuellement chaque échantillon. *Objectif de la feuille de route : v0.9.*
- **Outils d'aide pour les environnements de développement.** L'outil auxiliaire est actuellement créé manuellement ; il n'y a pas de package `pip install backprop-trace-pytorch`, ni de script `scripts/python-helpers/dump_pytorch_trace.py` prêt à l'emploi. Le chemin pour passer de "J'ai une étape PyTorch" à "J'ai un relevé de suivi" est trop long. *Objectif de la feuille de route : v0.10.*
- **Exemple concret.** L'exemple pédagogique de Mazur 2-2-2 est au cœur du système. Un vérificateur v1.0 devrait avoir au moins une architecture reconnaissable (petite CNN avec propagation avant et arrière, petit bloc de transformateur) intégrée. *Objectif de la feuille de route : v0.11.*
- **Validation par les utilisateurs.** Pas d'étude de cas de chercheurs externes, pas de cours utilisant ce système pour l'enseignement, pas d'ingénieur en conformité qui l'aurait utilisé pour un ensemble d'audit. *Objectif de la feuille de route : avant toute promotion en v1.0.*
- **Déterminisme sur GPU.** Hors de portée (et probablement restera ainsi — les opérations atomiques de cuDNN ConvolutionBackwardFilter empêchent la reproductibilité bit à bit entre les exécutions, [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La position du produit est : déterminisme sur CPU.

Si votre flux de travail dépend de l'une de ces fonctionnalités, cette version n'est pas encore adaptée à vos besoins.

## Création de topologies personnalisées

Contrôlez le moteur à partir d'un fichier de configuration JSON — aucune modification TypeScript requise :

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Consultez [`docs/authoring.md`](./docs/authoring.md) pour un guide pas à pas — schémas d'entrée et de relevé de suivi, la limite de confiance pour les émissions canoniques.

## Où ce système trouve sa place

- **Auteurs d'articles axés sur la reproductibilité** (soumissions à NeurIPS/ICML/CoLLAs ; chercheurs sensibilisés à REFORMS — Kapoor et al., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — preuves dérivables pour chaque étape que l'examinateur peut exécuter en 30 secondes.
- **Pédagogie en machine learning** (Karpathy zero-to-hero, cours universitaires de deep learning, préparation aux entretiens en systèmes de machine learning) — une seule étape d'entraînement nommée avec tous les facteurs visibles et un outil de réconciliation qui *rejette* les exemples délibérément corrompus.
- **Ingénieurs de frameworks/compilateurs de machine learning** (PyTorch / JAX / MLIR / XLA contributors) — générer une trace de référence pour chaque opération afin de tester la compatibilité avec les nouvelles sorties du compilateur.
- **Ingénieurs de la conformité/de l'audit en machine learning** (implémenteurs de l'article 10 de la loi européenne sur l'IA, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); consommateurs de SLSA-for-ML) — un format de relevé de suivi par étape, inférieur à la signature du modèle, et attaché à une carte de modèle ou à un ensemble d'audit.

## Références :

- **Lignée de la preuve de l'apprentissage** — Jia et al. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) pour l'idée structurelle ; Fang et al. (EuroS&P 2023) pour l'avertissement important selon lequel la preuve de l'apprentissage est falsifiable en pratique. backprop-trace se limite à la vérification CPU à une seule étape, atteignant un niveau de déterminisme.
- **REFORMS** — Kapoor et al. (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — liste de contrôle de reproductibilité de l'apprentissage automatique comprenant 32 éléments ; les preuves par étape, présentées sous forme de reçus, correspondent aux éléments 24 à 30.
- **Doctrine Csmith + CompCert** — Yang et al. (PLDI 2011) et Leroy (CACM 2009) — des corpus adverses prouvent l'existence d'un vérificateur ; l'oracle ne doit pas consulter l'artefact qu'il évalue.
- **Attestation de la chaîne d'approvisionnement** — in-toto v1, SLSA Provenance v1.0, modèle de transparence de Sigstore ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — les reçus backprop-trace peuvent être intégrés comme sujets de déclaration DSSE.

CE N'EST PAS zkML (pas de concision cryptographique). CE N'EST PAS opML (pas de jeu de preuve de fraude). CE N'EST PAS un enregistreur de métriques d'apprentissage automatique — backprop-trace écrit des chaînes de caractères décimales au lieu de nombres à virgule flottante binaires ; cela ressemble davantage à Jest snapshots / Rust insta.

## La pile de règles

Extrait du fichier `docs/canonical-emission.md` :

> Le contrat précède le moteur. La politique de formatage précède le formatage en temps réel. Les reçus incorrects précèdent les reçus corrects. Le formatage en temps réel précède Mazur. Mazur précède les diagnostics.

## Liens

- [`docs/quickstart.md`](./docs/quickstart.md) — présentation rapide en cinq minutes
- [`docs/cli.md`](./docs/cli.md) — référence de la sous-commande `bp`
- [`docs/authoring.md`](./docs/authoring.md) — création d'une topologie personnalisée
- [`docs/reconciliation.md`](./docs/reconciliation.md) — les 16 règles de réconciliation
- [`docs/topology.md`](./docs/topology.md) — création de topologies générales
- [`docs/multi-step.md`](./docs/multi-step.md) — reçus d'entraînement en plusieurs étapes (créés par le moteur)
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — contrat d'encodage au niveau des octets
- [`docs/computation-order.md`](./docs/computation-order.md) — ordre IEEE 754 ; interdiction de FMA ; tolérance hybride ; limite du déterminisme
- [`docs/schema.md`](./docs/schema.md) — présentation détaillée du schéma, champ par champ
- [`docs/attestation.md`](./docs/attestation.md) — mécanisme d'attestation in-toto v1
- `fixtures/` — exemples canoniques (Mazur, XOR, XOR par biais de neurone, iris, softmax-CE, XOR en plusieurs étapes), exemples externes avec mode observateur (PyTorch, JAX, TensorFlow), exemples de reçus "défectueux" intentionnellement (un par règle de réconciliation)
- `schemas/` — reçus v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, entrée de topologie v0.4.0, traçage du framework v0.1.0 (tous fermés, annotés avec `x-order`, additifs)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — la pile de contributions, le mécanisme anti-circularité, la doctrine des reçus "défectueux" avant les reçus "bons"
- [`SECURITY.md`](./SECURITY.md) — ce qui constitue une vulnérabilité pour un vérificateur
- [`CHANGELOG.md`](./CHANGELOG.md) — historique version par version

## Licence

MIT — voir `LICENSE`.
