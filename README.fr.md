<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Un vérificateur déterministe, basé sur 26 règles, pour les étapes de formation des réseaux neuronaux. Vous lui fournissez un fichier contenant tous les facteurs qui ont contribué à une mise à jour du gradient ; le vérificateur recalcule chaque affirmation et rejette les incohérences. Conformément à la philosophie de Csmith/CompCert, *"l'oracle ne doit pas consulter l'artefact qu'il juge."*

> **Statut : version bêta v0 (v0.11.0) — première version publiable.** Fonctionne uniquement sur CPU. Le vérificateur couvre SGD + Adam + AdamW + l'impulsion SGD de type PyTorch (classique + Nesterov + amortissement).
> Un utilitaire PyTorch ( `scripts/extract/pytorch.py`) couvre les mêmes optimiseurs. Il s'agit d'un observateur uniquement ; [la règle 14](./docs/reconciliation.md) est la référence.
> La version 0.11 est la première version publiée sur npm ; la version 1.0 est toujours conditionnée par [une configuration de test réaliste + validation par les utilisateurs + utilitaires en direct pour plusieurs frameworks](#whats-not-in-this-version-yet). Consultez le fichier [`docs/live-helpers.md`](./docs/live-helpers.md) avant toute utilisation en production.

## Démarrage rapide en 30 secondes

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

L'exemple Mazur 2-2-2 est la description la plus citée, étape par étape, de la rétropropagation disponible sur le web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Chaque nombre peut être dérivé manuellement.

## Ce qu'est cet outil

Un vérificateur de la correction numérique pour une seule étape de formation. Le vérificateur applique 26 règles qui recalculent chaque affirmation à partir des facteurs spécifiés. Si une règle quelconque présente une divergence, même minime (`atol + rtol`), le fichier est rejeté. Les règles 9 et 10 (multi-étapes), les règles 18 et 19 (regroupement), les règles 22 à 24 (récurrence de l'impulsion Adam), les règles 20 et 21a/21b/21c + 25 + 26 (récurrence de l'impulsion SGD) et la règle 14 (recalcul différentiel du moteur à partir des traces du framework importé) couvrent les aspects pertinents pour la production.

Il **ne** valide pas l'ensemble de la formation, ne prouve pas que le modèle est correct, et ne remplace pas un outil de suivi des expériences. Il prouve que chaque étape enregistrée est mathématiquement cohérente et que la chaîne est intacte. Des ensembles de données adverses permettent de tester un vérificateur ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) ; chaque règle est accompagnée d'une configuration incorrecte correspondante, située dans le répertoire [`fixtures/bad/`](./fixtures/bad), que le vérificateur doit rejeter *avant* de lire les métadonnées `fixture_status`.

## Utilitaire PyTorch en direct (v0.10+)

Un seul fichier Python lisible. Pas de paquet pip par conception ; copiez-le dans votre dépôt, lisez-le et exécutez-le.

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

L'utilitaire génère un fichier auxiliaire `framework-trace.v0.7.0` contenant un bloc "helper" avec des informations forensiques (nom, version, hash de la source, version du framework, environnement d'exécution, horodatage de l'extraction). Ce bloc **n'est pas une preuve d'authenticité** ; la règle 14 (recalcul différentiel du moteur) est la référence pour chaque fichier auxiliaire généré, quel que soit ce que l'utilitaire prétend. Un `source_hash` falsifié, incorrect ou manquant **ne contourne pas** la règle 14. Consultez le fichier [`docs/live-helpers.md`](./docs/live-helpers.md) pour la déclaration de limite de confiance, la liste des éléments interdits, le catalogue de 9 configurations adverses et le contrat de distribution sans pip.

**Pris en charge (v0.10.x)** : PyTorch SGD + Adam + AdamW + sgd_momentum (classique/Nesterov/amortissement, avec l'inversion du signe de l'impulsion `momentum_buffer` de l'ascension à la descente, comme décrit dans [l'article PyTorch #1099](https://github.com/pytorch/pytorch/issues/1099)). Fonctionne uniquement sur CPU. Prise en charge des configurations simples et multi-étapes.
**Exclusions :** AMP/autocast, CUDA/MPS/XLA, SGD avec décroissance de poids L2 couplée, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologies multi-couches cachées. Les fichiers auxiliaires créés manuellement pour ces frameworks/optimiseurs continuent de fonctionner via le chemin standard `bp import`.

## Ce que ce n'est pas

- **Ce n'est pas un outil de suivi d'expériences.** Utilisez [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) ; ces outils enregistrent les informations relatives aux expériences. `backprop-trace` permet de vérifier la cohérence interne des calculs.
- **Ce n'est pas une preuve de l'apprentissage (Proof-of-Learning) ni une preuve cryptographique de l'apprentissage (zkML).** [PoL](https://arxiv.org/abs/2103.05633) a été démontré comme pouvant être falsifié lors d'entraînements réels ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)) ; zkML produit des preuves cryptographiques. `backprop-trace` n'est pas cryptographique, fonctionne par étapes, et est destiné à être utilisé par un humain ou un outil de revue de code.
- **Ce n'est pas une attestation de la chaîne d'approvisionnement.** [La signature de modèles Sigstore](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestent de l'origine des pipelines ; `backprop-trace` atteste de la cohérence numérique. Un ML-BOM peut référencer un reçu `backprop-trace` comme une condition de cohérence interne.

## Modèle de menace

Ce qui est couvert : tout reçu qui devrait être rejeté mais qui est accepté, notamment les contournements de schéma, les injections de NaN/Infinity, les divergences d'émission canonique, les violations de circularité, et les désaccords de recalcul du moteur concernant les modules complémentaires importés. Ce qui n'est pas couvert : la fiabilité de l'exécution d'entraînement elle-même, les attaques par canaux cachés sur le processus de vérification. Le déterminisme est limité : une sortie identique au niveau des octets est garantie uniquement pour la même version de `backprop-trace`, Node.js 22.x et la même spécification d'émission canonique. Consultez [SECURITY.md](./SECURITY.md) pour la liste complète et le calendrier des divulgations.

## Installation

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fixé à Node 22.x (le déterminisme de `Math.exp` de V8 fdlibm est essentiel - voir [`docs/computation-order.md`](./docs/computation-order.md)).

## Interface en ligne de commande (CLI)

Référence complète : [`docs/cli.md`](./docs/cli.md).

| Verbe | Objectif |
|---|---|
| `bp reconcile receipt <file>` | Exécuter les 26 règles ; quitter avec le code 1 en cas de première erreur. |
| `bp verify mazur` | Vérification complète de la fixture Mazur intégrée. |
| `bp verify general <file>` | Vérification généralisée (récépés v0.2+ : XOR, iris, softmax+CE, mode observateur). |
| `bp verify multi <file.jsonl>` | Fichier JSONL multi-enregistrements + règles 9/10 inter-enregistrements. |
| `bp generate {mazur,xor,iris}` | Relancer le moteur spécifié, générer des octets canoniques. |
| `bp generate from-config <file>` | Relancer le moteur à partir d'une topologie et d'une entrée au format JSON. |
| `bp scaffold topology --topology mazur` | `xor` | `iris` | Créer un fichier de configuration de base. |
| `bp validate-input <file>` | Valider le schéma d'une topologie et d'une entrée. |
| `bp validate <file>` | Valider le schéma d'un reçu (détection automatique de la version 0.1 à 0.7). |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Importer une trace d'un framework externe. |
| `bp examples pytorch [--print]` | Afficher le chemin (ou afficher le contenu) de l'outil PyTorch intégré. |

Options courantes : `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, l'argument de fichier `-` représente l'entrée standard. Codes de sortie : `0` succès · `1` échec de vérification · `2` erreur d'utilisation/I-O · `3` argument CLI invalide · `4` framework non implémenté.

## Bibliothèque

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

Importations de sous-répertoires : `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, ainsi que la famille de schémas `./schema/...`.

## Les 16 règles

Instructions complètes + fixtures adverses : [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Règle |
|---|---|
| 0 | Sentinelle de défaillance structurelle (au niveau du schéma) |
| 0.8 | Limites de probabilité : les sorties softmax doivent être comprises entre [0, 1] |
| 1-4 | Signaux d'erreur (sortie, en aval, cachés) + cohérence de la mise à jour du gradient. |
| 5-7 | Mise à jour de la valeur, progression du poids, état final (branche AdamW pour le wd découplé, règles 6/7). |
| 8 | Cohérence de la référence d'origine |
| 9-10 | Chaîne de paramètres multi-étapes + identité de la trace. |
| 11-13 | Normalisation softmax + formule de perte + forme duale (GATED). |
| 14 | Différentiel de recalcul du moteur (OBLIGATOIRE pour les imports en mode observateur). |
| 15-17 | Base de saut + liaison de la somme de contrôle signée + liaison de la racine du paquet (GATED). |
| 18-19 | Cohérence de la réduction par lots + cohérence de l'ensemble d'échantillons (GATED). |
| 20 | Forme de l'état de l'optimiseur (Adam `{m, v}` / sgd_momentum `{buffer}`). |
| 21 | **Momentum SGD de type PyTorch** : 21a récurrence du buffer + 21b direction effective + 21c mise à jour du paramètre. |
| 22-24 | Adam : récurrences, correction des biais, mise à jour des paramètres (epsilon en dehors de la racine carrée). |
| 25-26 | Chaîne d'optimiseurs à plusieurs étapes + constance de la configuration de l'optimiseur. |

## Portée du déterminisme

Contractuel pour Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x : données de référence exactes en octets (Mazur, XOR, iris, softmax+CE, multi-étape, par lots, modules complémentaires externes) ; l'ancre Mazur `post_update_loss.total = 0.29102777369359933` ; réconciliation par règle avec `atol=1e-12` et `rtol=1e-9` pour les éléments générés par le moteur.

NON contractuel : inter-moteurs (Bun, Deno, navigateurs) ; inter-versions majeures de Node (24.x+) ; modifications mineures arbitraires de V8. Un "canari" `Math.exp(-0.5)` est déclenché dans chaque cellule CI comme indicateur de dérive de fdlibm de V8.

## Ce qui n'est pas inclus dans cette version (pour l'instant)

backprop-trace v0.11.0 est la première version publiée sur npm, mais est **toujours en version préliminaire (mid-v0)**. Le moteur, le réconciliaur, le contrat d'émission canonique, le chemin d'ingestion externe et l'outil d'aide PyTorch sont réels et stables. La version 1.0 nécessite que les éléments suivants soient finalisés :

- **Traces multi-framework hétérogènes** — uniquement des bundles pour un seul framework ; les flux multi-framework ne sont pas pris en charge. *Peut ne pas être inclus dans la portée.*
- **Liaison de l'identité du producteur dans les traces multi-étapes** — La règle 17 détecte les échecs d'intégrité du bundle, mais pas l'authenticité du producteur. À combiner avec la règle 16 / Sigstore / attestation hors bande. Une fonctionnalité, pas une intégration native.
- **Décroissance de poids L2 couplée à SGD** — Branche 3 de la règle 7 ; *v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / groupes de paramètres par paramètre / calendriers d'apprentissage / découpage du gradient / précision mixte** — *v0.10+.*
- **Gradients par échantillon dans les reçus par lots** — uniquement des gradients réduits pour le moment ; la décomposition par échantillon est utile pour les audits d'influence. *v0.10.x / v0.11.*
- **Tailles de lots hétérogènes entre les étapes** — taille de lot fixe par flux. *Peut ne pas être inclus dans la portée.*
- **Outils d'aide JAX / TensorFlow** — les modules complémentaires écrits manuellement fonctionnent ; les outils d'aide sont *v0.11 (JAX, déclenchement adopter-pull) / v0.12+ (TF).*
- **Configuration de test réaliste** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur sont les éléments clés ; la configuration CNN / bloc transformateur est *v0.11.*
- **Validation de l'utilisateur** — aucune étude de cas de chercheur externe, aucune adoption dans un cours, aucun bundle de conformité en production. *v0.12 avant v1.0.*
- **Déterminisme GPU** — hors de portée et probablement permanent (les opérations atomiques de convolution cuDNN violent la précision bit à bit, comme indiqué par [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). La position du produit est dans le domaine du CPU déterministe.

Si votre flux de travail dépend de l'une de ces fonctionnalités, cette version n'est pas encore adaptée à vos besoins.

## Définir une topologie personnalisée

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Voir [`docs/authoring.md`](./docs/authoring.md) — schémas d'entrée par rapport aux reçus, limite de confiance de l'émission canonique.

## Où ce système trouve sa place

- **Auteurs d'articles axés sur la reproductibilité** (NeurIPS/ICML/CoLLAs ; sensibilisation à [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) — preuves dérivables par étape que le réviseur exécute en 30 secondes.
- **Pédagogie de l'apprentissage automatique** (Karpathy zero-to-hero, cours universitaires de deep learning, préparation aux entretiens) — une seule étape d'entraînement nommée avec tous les facteurs visibles et un réconciliaur qui *rejette* les configurations délibérément corrompues.
- **Ingénieurs de frameworks / compilateurs d'apprentissage automatique** (PyTorch / JAX / MLIR / contributeurs XLA) — trace connue et fiable pour chaque opération pour les tests différentiels.
- **Ingénieurs de conformité / d'audit de l'apprentissage automatique** ([Article 10 de la loi européenne sur l'IA](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — reçu par étape en dessous de la signature du modèle, attaché à une carte de modèle ou à un bundle d'audit.

## La pile de règles

Extrait du fichier `docs/canonical-emission.md` :

> Le contrat précède le moteur. La politique de formatage précède le formatage en temps réel. Les reçus incorrects précèdent les reçus corrects. Le formatage en temps réel précède Mazur. Mazur précède les diagnostics.

## Liens

- [`docs/quickstart.md`](./docs/quickstart.md) — Guide rapide en cinq minutes.
- [`docs/cli.md`](./docs/cli.md) — Référence de la sous-commande `bp`.
- [`docs/live-helpers.md`](./docs/live-helpers.md) — Assistants PyTorch en direct v0.10 : flux de travail, limites de confiance, catalogue d'attaques, justification de l'absence de dépendance à `pip`.
- [`docs/authoring.md`](./docs/authoring.md) — Création d'une topologie personnalisée.
- [`docs/reconciliation.md`](./docs/reconciliation.md) — Les 26 règles de réconciliation, en détail.
- [`docs/topology.md`](./docs/topology.md) — Création de topologies générales.
- [`docs/multi-step.md`](./docs/multi-step.md) — Procédures d'entraînement en plusieurs étapes.
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — Contrat d'encodage au niveau des octets.
- [`docs/computation-order.md`](./docs/computation-order.md) — Ordre des opérations IEEE 754 ; interdiction de FMA ; limites du déterminisme.
- [`docs/schema.md`](./docs/schema.md) — Explication détaillée du schéma, champ par champ.
- [`docs/attestation.md`](./docs/attestation.md) — Intégration de l'attestation in-toto v1.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — Mécanisme anti-circularité ; principe "les mauvaises entrées précèdent les bonnes".
- [`SECURITY.md`](./SECURITY.md) — Ce qui constitue une vulnérabilité pour un vérificateur.
- [`CHANGELOG.md`](./CHANGELOG.md) — Historique des versions.

## Licence

MIT — voir [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
