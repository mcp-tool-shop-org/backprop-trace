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

Un vérificateur déterministe basé sur 26 règles pour les étapes d’entraînement des réseaux de neurones. Vous lui fournissez un enregistrement indiquant tous les facteurs qui ont contribué à une mise à jour du gradient ; le réconciliateur redérive chaque affirmation et rejette en cas de désaccord. Dans la lignée Csmith/CompCert, on rappelle que « l’oracle ne doit pas consulter l’artefact qu’il juge ».

> **v1.0.0 — Uniquement CPU, déterministe.** Le vérificateur couvre SGD, Adam, AdamW, SGD avec momentum (classique/Nesterov/amortissement), **SGD couplé à une décroissance L2 des poids**, sur 26 règles de réconciliation. Des assistants **PyTorch et JAX** en direct extraient une étape d’entraînement réelle dans un enregistrement vérifiable — uniquement pour l’observateur, la [Règle 14](./docs/reconciliation.md) est la référence pour chaque élément importé. 940 tests déterministes ; seuils de tolérance définis par le vérificateur ; mécanisme anti-circularité. Consultez [`docs/live-helpers.md`](./docs/live-helpers.md) avant une utilisation en production et le [JOURNAL DES MODIFICATIONS](./CHANGELOG.md) pour l’historique des versions.

## Démarrage rapide en 30 secondes

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

Le modèle Mazur 2-2-2 est la démonstration de rétropropagation pas à pas la plus citée sur le web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Chaque nombre qu’il contient peut être dérivé manuellement.

## Ce que c’est

Un vérificateur de correction numérique pour une étape d’entraînement. Le réconciliateur examine 26 règles qui redérivent chaque affirmation à partir des facteurs nommés. Si une règle quelconque est en désaccord dans la tolérance hybride (`atol + rtol`), l’enregistrement est rejeté. Les étapes multiples (Règles 9 et 10), les traitements par lots (Règles 18 et 19), les récurrences de momentum Adam (Règles 22-24), la récurrence de momentum SGD (Règles 20 + 21a/21b/21c + 25 + 26) et le recalcul différentiel du moteur sur les traces importées du framework (Règle 14) couvrent les aspects pertinents pour la production.

Il ne valide **pas** l’ensemble de l’exécution de l’entraînement, ne prouve pas que le modèle est correct et ne remplace pas un outil de suivi des expériences. Il prouve que chaque étape enregistrée est mathématiquement cohérente et que la chaîne est intacte. Des corpus adverses prouvent qu’un vérificateur fonctionne ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) ; [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — chaque règle est livrée avec un exemple incorrect associé dans [`fixtures/bad/`](./fixtures/bad) que le vérificateur doit rejeter *avant* de lire les métadonnées `fixture_status`.

## Assistant PyTorch en direct (v0.10+)

Fichier Python unique et auditable. Pas de package pip par conception — copiez-le dans votre dépôt, lisez-le, exécutez-le.

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

L’assistant émet un fichier secondaire `framework-trace.v0.7.0` avec un bloc `helper` à des fins d’analyse (nom, version, hachage de la source, version du framework, environnement d’exécution, horodatage de l’extraction). Le bloc n’est **pas une information d’identification** — la Règle 14 (recalcul différentiel du moteur) est la référence pour chaque fichier secondaire émis par l’assistant, quels que soient les éléments que l’assistant prétend. Un `source_hash` falsifié/incorrect/manquant ne contourne **pas** la Règle 14. Consultez [`docs/live-helpers.md`](./docs/live-helpers.md) pour connaître la déclaration sur la limite de confiance, la liste interdite, le catalogue adversarial à 9 éléments et le contrat d’absence de distribution pip.

**Pris en charge :** PyTorch SGD + Adam + AdamW + sgd_momentum (classique/Nesterov/amortissement) + **SGD couplé à une décroissance L2 des poids**, avec l’inversion du signe `momentum_buffer` de l’ascension vers la descente, comme indiqué dans [le problème PyTorch n° 1099](https://github.com/pytorch/pytorch/issues/1099). Priorité au CPU. Étape unique + étapes multiples. Un **assistant JAX en direct parallèle** (`scripts/extract/jax.py`) couvre SGD + Adam avec une limite de confiance plus stricte — il inclut un résumé `jax.make_jaxpr(jax.grad(loss))` dans le bloc d’analyse (le graphe de gradient inspectable que PyTorch eager n’a pas) et refuse de s’exécuter sans `jax_enable_x64` + CPU. Consultez [`docs/live-helpers.md`](./docs/live-helpers.md).
**Rejeté à la limite :** AMP/autocast, CUDA/MPS/XLA, AMSGrad/NAdam/RAdam/Lion/LBFGS, topologies multi-couches cachées. Les fichiers secondaires créés manuellement pour ces frameworks/optimiseurs continuent de fonctionner via le chemin standard `bp import`.

## Ce que ce n’est pas

- **Pas un outil de suivi des expériences.** Utilisez [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) — ces outils enregistrent les affirmations ; la rétropropagation redérive si les calculs sont cohérents en interne.
- **Pas une preuve d’apprentissage ou un zkML.** Il a été démontré que [PoL](https://arxiv.org/abs/2103.05633) pouvait être falsifié sur des données d’entraînement réelles ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)) ; zkML produit des preuves cryptographiques. La rétropropagation n’est pas cryptographique, elle est effectuée en une seule étape et son public est un humain ou un réviseur CI.
- **Pas une attestation de la chaîne d’approvisionnement.** [Sigstore model-signing](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attestent de la provenance du pipeline ; la rétropropagation atteste de la cohérence numérique. Un ML-BOM peut faire référence à un enregistrement de rétropropagation en tant que prédicat de cohérence interne.

## Modèle de menace

Ce qui est pris en compte : tout enregistrement qui devrait être rejeté mais est accepté — contournement du schéma, empoisonnement par NaN/Infini, divergence d’émission canonique, violations de l’anti-circularité, désaccord sur le recalcul du moteur sur les fichiers secondaires importés. Ce qui n’est pas pris en compte : la fiabilité de l’exécution de l’entraînement elle-même, les attaques par canaux auxiliaires sur le processus de vérification. Le déterminisme est limité : une sortie identique au niveau des octets n’est garantie que pour la même version de rétropropagation, Node.js 22.x et la même spécification d’émission canonique. Consultez [SECURITY.md](./SECURITY.md) pour l’énumération complète + le calendrier de divulgation.

## Installation

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Fixé à Node 22.x (le déterminisme de `Math.exp` de V8 fdlibm est essentiel — voir [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI

Référence complète : [`docs/cli.md`](./docs/cli.md).

| Verbe | Objectif |
|---|---|
| `bp reconcile receipt <file>` | Exécuter les 26 règles ; quitter avec le code 1 en cas de première erreur |
| `bp verify mazur` | Validation complète sur l’ensemble de données Mazur fourni. |
| `bp verify general <file>` | Porte généralisée (v0.2+ : XOR, iris, softmax+CE, mode observateur) |
| `bp verify multi <file.jsonl>` | JSONL multi-enregistrements + règles inter-enregistrements (9/10) |
| `bp generate {mazur,xor,iris}` | Relancer le moteur spécifié et générer les octets canoniques |
| `bp generate from-config <file>` | Relancer le moteur à partir d’une topologie + d’un fichier JSON en entrée |
| `bp scaffold topology --topology mazur\ | xor\ | iris` | Écrire une configuration d’entrée de base |
| `bp validate-input <file>` | Valider la conformité d’une configuration de topologie + d’entrée par rapport à un schéma |
| `bp validate <file>` | Valider la conformité d’un résultat (détection automatique des versions v0.1-v0.7) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Ingérer les données de traçage d’une infrastructure externe |
| `bp examples {pytorch,jax} [--print]` | Afficher le chemin d’accès (ou afficher le contenu) du module d’aide PyTorch/JAX actif inclus |

Options courantes : `--out <fichier>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, argument de fichier `-` = entrée standard. Codes de sortie : `0` succès, `1` échec de la vérification, `2` utilisation/E-S, `3` argument CLI non valide, `4` infrastructure non implémentée.

## Bibliothèque

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

> **Quelle porte prouve quoi.** `reconcileReceipt` prouve que les calculs du résultat sont
> *internement cohérents* (les 26 règles redérivent chaque affirmation à partir des
> propres facteurs du résultat). Pour un résultat d’**origine inconnue**, associez-le au
> module de vérification de la reproduction du moteur : `verifyEngineReproduces` (ou `bp verify general`),
> qui relance le moteur déterministe à partir des entrées du résultat et compare
> champ par champ. Cette deuxième porte est celle qui ferme l’enveloppe anti-circularité :
> la cohérence interne seule ne peut pas détecter un résultat étranger qui aurait été
> renommé comme étant généré par le moteur, car aucune règle spécifique au résultat ne redérive
> le passage avant pour un résultat généré par le moteur. Les importations en mode observateur
> (`importPytorchSidecar`) exécutent automatiquement la comparaison différentielle de reproduction du moteur (règle 14) ; `bp verify` exécute toujours les deux portes.

Importations de sous-répertoires : `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, ainsi que la famille de schémas `./schema/...`.

## Les 26 règles

Déclarations complètes + exemples contradictoires : [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Règle |
|---|---|
| 0 | Sentinelle de défaillance structurelle (niveau schéma) |
| 0.8 | Limites de probabilité : sorties softmax dans [0, 1] |
| 1-4 | Signaux d’erreur (sortie, en aval, cachés) + cohérence du gradient de mise à jour |
| 5-7 | Valeur de mise à jour, progression des poids, état final (branche AdamW sur les règles 6/7 pour une décroissance pondérale découplée) |
| 8 | Cohérence de la référence de provenance |
| 9-10 | Chaîne de paramètres multi-étapes + identité du traçage |
| 11-13 | Normalisation softmax + formule de perte + forme duale (GATED) |
| 14 | Comparaison différentielle de recalcul par le moteur (OBLIGATOIRE pour les importations en mode observateur) |
| 15-17 | Liaison de base de saut + liaison de hachage signé + liaison à la racine du paquet (GATED) |
| 18-19 | Cohérence de réduction par lot + cohérence de l’ensemble d’échantillons (GATED) |
| 20 | Forme de l’état de l’optimiseur (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **Momentum SGD de type PyTorch :** 21a récurrence du tampon + 21b direction effective + 21c mise à jour des paramètres |
| 22-24 | Récurrences du moment Adam + correction de biais + mise à jour des paramètres (epsilon À L’EXTÉRIEUR de la racine carrée) |
| 25-26 | Chaîne d’état de l’optimiseur multi-étapes + constance de la configuration de l’optimiseur |

## Portée du déterminisme

Contractuel sur Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.12.x : valeurs dorées identiques (Mazur, XOR, iris, softmax+CE, multi-étapes, par lots, modules externes) ; l’ancrage Mazur `post_update_loss.total = 0.29102777369359933` ; réconciliation par règle dans `atol=1e-12`, `rtol=1e-9` pour les résultats générés par le moteur.

NON contractuel : inter-moteurs (Bun, Deno, navigateurs) ; inter-Node majeur (24.x+) ; modifications mineures arbitraires de V8. Un indicateur `Math.exp(-0.5)` se déclenche sur chaque cellule CI en tant que sirène de dérive fdlibm de V8.

## Ce qui n’est pas inclus dans cette version (pour l’instant)

La v1.0.0 couvre le cas d’utilisation du CPU déterministe de bout en bout : le moteur, le réconciliateur, le contrat d’émission canonique, le chemin d’ingestion externe, les modules d’aide PyTorch **et** JAX actifs, les optimiseurs de la famille SGD, y compris la décroissance pondérale couplée L2, un exemple représentatif et un ensemble de conformité fonctionnel [ici](./docs/compliance.md). La feuille de route ci-dessous indique ce qui n’est **pas encore couvert**, par ordre d’utilisation × faisabilité de vérification, chaque élément étant conditionné par un recalcul CPU en forme fermée que le réconciliateur peut réellement gérer :

- **NAdam (+ éventuellement RAdam)** : variantes économiques d’Adam. Ensuite, **vérification du programme d’apprentissage**, qui s’applique à chaque optimiseur. *Ensuite.*
- **AMSGrad / écrêtage de gradient global / taux d’apprentissage par groupe / Lion** : chacun est activé via une extension de réception/de réconciliation. *Plus tard.*
- **Topologies Conv / multi-couches cachées** : le moteur est une couche dense à une seule couche cachée ; l’élément clé est un classificateur dense ReLU→softmax reconnaissable. Conv apporte un ordre FP avec noyau fusionné qui lutte contre la déterminisme au niveau du bit (voir GPU ci-dessous). *Probablement en dehors du domaine de déterminisme CPU.*
- **Traces multi-cadres hétérogènes** : uniquement des ensembles à cadre unique ; les flux multi-cadres ne sont pas pris en charge. *Pourrait rester hors du champ d’application.*
- **Tailles de lots hétérogènes entre les étapes** : taille de lot fixe par flux. *Pourrait rester hors du champ d’application.*
- **Gradients par échantillon dans les réceptions groupées** : uniquement des gradients réduits aujourd’hui ; la décomposition par échantillon est utile pour les audits d’influence, mais n’est pas encore disponible. *Plus tard.*
- **Liaison de l’identité du producteur sur les traces multi-étapes** : la règle 17 détecte les échecs d’intégrité de l’ensemble, et non l’authenticité du producteur. Combiner avec la règle 16 / Sigstore / attestation hors bande. Surface opérateur, pas une fonctionnalité intégrée.
- **GPU / déterminisme au niveau du bit avec noyau fusionné** : hors du champ d’application et permanent. La non-associativité des nombres à virgule flottante rend l’exactitude au niveau du bit inatteignable dans les noyaux fusionnés/parallèles ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148) ; opérations atomiques cuDNN ConvolutionBackwardFilter selon [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). Le résultat est le domaine CPU déterministe.

Si votre flux de travail dépend de l’un de ces éléments, cette version n’est pas encore adaptée à vos besoins.

## Créer une topologie personnalisée

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

Voir [`docs/authoring.md`](./docs/authoring.md) : schémas d’entrée par rapport aux schémas de réception, limite de confiance pour l’émission canonique.

## Où cela s’intègre

- **Auteurs d’articles axés sur la reproductibilité** (NeurIPS/ICML/CoLLAs ; conscients de [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)) : preuves étape par étape qui peuvent être reproduites et que le relecteur peut exécuter en 30 secondes.
- **Pédagogie de l’apprentissage automatique** (Karpathy, du zéro au héros, cours universitaires sur l’apprentissage profond, préparation aux entretiens) : une seule étape d’entraînement nommée avec tous les facteurs visibles et un réconciliateur qui *rejette* délibérément les éléments défectueux.
- **Ingénieurs de cadres / compilateurs d’apprentissage automatique** (contributeurs PyTorch / JAX / MLIR / XLA) : trace opération par opération connue pour les tests différentiels.
- **Ingénieurs de conformité / d’audit de l’apprentissage automatique** ([Annexe IV, § 2(g) du règlement européen sur l’IA, journaux de validation/tests + article 15 sur la robustesse](https://artificialintelligenceact.eu/annex/4/) ; SLSA pour l’apprentissage automatique) : une réception étape par étape en tant qu’enregistrement de test vérifiable, daté et signable, placé sous la signature du modèle. Voir l’ensemble de conformité élaboré [ici](./docs/compliance.md) (et le champ d’application honnête : les reçus attestent des *mathématiques*, pas de la gouvernance des données).

## L’ensemble des lois

Extrait de `docs/canonical-emission.md` :

> Le contrat précède le moteur. La politique du formateur précède la mise en forme à l’exécution. Les mauvais reçus précèdent les bons reçus. La mise en forme à l’exécution précède Mazur. Mazur précède les diagnostics.

## Liens

- [`docs/quickstart.md`](./docs/quickstart.md) : présentation rapide en cinq minutes
- [`docs/cli.md`](./docs/cli.md) : référence de la sous-commande `bp`
- [`docs/live-helpers.md`](./docs/live-helpers.md) : assistant PyTorch v0.10 en direct : flux de travail, limite de confiance, catalogue d’attaques adverses, justification de l’absence de pip
- [`docs/authoring.md`](./docs/authoring.md) : créer une topologie personnalisée
- [`docs/reconciliation.md`](./docs/reconciliation.md) : les 26 règles du réconciliateur en intégralité
- [`docs/topology.md`](./docs/topology.md) : création de topologies générales
- [`docs/multi-step.md`](./docs/multi-step.md) : reçus d’entraînement multi-étapes
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) : contrat d’encodage au niveau des octets
- [`docs/computation-order.md`](./docs/computation-order.md) : ordre IEEE 754 ; interdiction de FMA ; limite du déterminisme
- [`docs/schema.md`](./docs/schema.md) : présentation détaillée du schéma, champ par champ
- [`docs/attestation.md`](./docs/attestation.md) : point d’attestation in-toto v1
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) : mécanisme anti-circularité ; doctrine des mauvais reçus qui précèdent les bons
- [`SECURITY.md`](./SECURITY.md) : ce qui constitue une vulnérabilité pour un vérificateur
- [`CHANGELOG.md`](./CHANGELOG.md) : historique version par version

## Licence

MIT — voir [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
