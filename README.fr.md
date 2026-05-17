<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

# @mcptoolshop/backprop-trace

Moteur de traçage déterministe pour l'entraînement : génère des fichiers JSONL canoniques représentant les étapes uniques de rétropropagation, vérifiés par un réconciliaur à 8 règles (les 8 règles sont intégrées dans la version 0.2).

## Pourquoi backprop-trace ?

Si vous enseignez, auditez ou vérifiez l'entraînement de réseaux neuronaux, vous avez besoin d'un moyen de dire "cette trace est cohérente". backprop-trace génère des fichiers de réception canoniques, au niveau des octets, pour chaque étape de rétropropagation, et un réconciliaur qui redérive chaque valeur à partir des facteurs nommés. La version 0.1 inclut l'exemple Mazur 2-2-2, l'exemple de rétropropagation pédagogique le plus cité sur le web, comme référence de régression, ainsi qu'un exemple "défectueux" qui prouve que le vérificateur rejette ce qu'il devrait rejeter.

Ce n'est **pas** un enregistreur de métriques d'apprentissage automatique (utilisez MLflow / W&B / TensorBoard pour cela). C'est un vérificateur de traçage structurel, dans la lignée de Proof-of-Learning (Jia et al. IEEE S&P 2021), et il est conçu pour des exemples pédagogiques à une seule étape, plutôt que pour l'ensemble du processus d'entraînement.

## Démarrage rapide en 30 secondes

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

Pour un guide plus détaillé, consultez [`docs/quickstart.md`](./docs/quickstart.md) ; pour la référence de l'interface en ligne de commande, [`docs/cli.md`](./docs/cli.md) ; pour le processus d'attestation, [`docs/attestation.md`](./docs/attestation.md).

## Installation

```
pnpm add @mcptoolshop/backprop-trace
```

Ou avec npm :

```
npm install @mcptoolshop/backprop-trace
```

## Utilisation de l'interface en ligne de commande

La version 0.2 inclut quatre sous-commandes. Référence complète : [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

Options courantes (voir [`docs/cli.md`](./docs/cli.md) pour la référence complète) :

- `--json` : sortie JSON lisible par machine (pour les systèmes d'intégration continue).
- `--verbose`, `-V` : messages de diagnostic sur la sortie d'erreur standard avant l'exécution.
- `--color=auto|never|always` : couleur de la sortie ; respecte la variable d'environnement `NO_COLOR`.
- L'argument de fichier `-` lit à partir de l'entrée standard ("réception de réconciliation", "validation", "vérification mazur").

Codes de sortie : 0 (succès), 1 (échec de la vérification), 2 (erreur d'entrée/sortie ou entrée incorrecte), 3 (argument de l'interface en ligne de commande invalide).

`bp --version` et `bp --help` fonctionnent sans sous-commande ; `bp <sous-commande> --help` affiche l'utilisation spécifique à la sous-commande.

## Utilisation en tant que bibliothèque

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

Consultez [`docs/attestation.md`](./docs/attestation.md) pour la correspondance in-toto v1.

Les importations de sous-chemins sont exportées (`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`).

## Ce qu'est cet outil

Un *vérificateur de traçage structurel* avec un encodage canonique au niveau des octets. La réception est le contrat ; le réconciliaur vérifie chaque affirmation contenue dans la réception et s'assure que les calculs sont corrects.

Références :

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) pour le principe des "réceptions incorrectes avant les réceptions correctes".

CE N'EST PAS zkML (pas de concision cryptographique). CE N'EST PAS opML (pas de jeu de preuve de fraude). CE N'EST PAS un enregistreur de métriques d'apprentissage automatique — backprop-trace écrit des chaînes de caractères décimales au lieu de nombres à virgule flottante binaires ; cela ressemble davantage à Jest snapshots / Rust insta.

## Portée du déterminisme

Fidélité du traçage à 9 chiffres significatifs, dans l'environnement ULP de V8/Node 22. Les valeurs du moteur supposent des nombres à virgule flottante IEEE 754 en virgule fixe sur V8.

La portabilité entre moteurs (Hermes, JSC, Bun-JSC) **n'est pas testée**. La valeur de référence largement citée `0.291027924` diffère de la valeur du moteur `0.29102777369359933` d'environ 1,5e-7 ; consultez `fixtures/mazur.published.json` pour le registre des écarts.

La version 0.1 est verrouillée à Node 22.x.

## Les huit règles

1. Cohérence du signal d'erreur de sortie
2. Contribution en aval et somme rétropropagée
3. Cohérence du signal d'erreur caché
4. Cohérence du gradient de mise à jour
5. Cohérence de la valeur de mise à jour
6. Progression des poids
7. Cohérence de l'état final
8. Cohérence de la référence d'origine

Les 8 règles sont implémentées dans la version 0.2 (la règle 4 a été introduite dans la version 0.1). Les descriptions complètes des règles se trouvent dans le fichier [`docs/reconciliation.md`](./docs/reconciliation.md) ; chaque règle est accompagnée d'un fichier de test délibérément incorrect `fixtures/bad/mazur.bad-<kind>.jsonl`, conformément à la doctrine Csmith.

## La pile de règles

Extrait du fichier `docs/canonical-emission.md` :

> Le contrat précède le moteur. La politique de formatage précède le formatage en temps réel. Les reçus incorrects précèdent les reçus corrects. Le formatage en temps réel précède Mazur. Mazur précède les diagnostics.

## Portée de la version 0.2

- Topologie Mazur 2-2-2 uniquement
- Entraînement en une seule étape uniquement
- Fonction d'activation sigmoïde + fonction de perte d'erreur quadratique moyenne (MSE) uniquement
- Biais par couche
- Optimiseur SGD (sans momentum, sans Adam, sans décroissance du poids)
- Uniquement pour CPU (aucune affirmation de déterminisme pour les GPU)
- Uniquement V8 / Node 22.x

L'entraînement multi-étapes, les topologies généralisées, les fonctions d'activation/perte alternatives et les optimiseurs plus avancés sont réservés à la version 0.3 et suivantes (voir le fichier [`CHANGELOG.md`](./CHANGELOG.md) pour les fonctionnalités incluses dans la version 0.2).

## Liens

- [`docs/quickstart.md`](./docs/quickstart.md) — présentation rapide en cinq minutes
- [`docs/cli.md`](./docs/cli.md) — référence de la sous-commande `bp` (version 0.2+)
- [`docs/reconciliation.md`](./docs/reconciliation.md) — les huit règles de réconciliation
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — contrat d'encodage au niveau des octets
- [`docs/computation-order.md`](./docs/computation-order.md) — règles d'ordonnancement IEEE 754 ; interdiction de FMA
- [`docs/schema.md`](./docs/schema.md) — description détaillée de chaque champ du schéma du reçu
- [`docs/attestation.md`](./docs/attestation.md) — mécanisme d'attestation in-toto v1 (version 0.2+)
- `fixtures/` — grand livre canonique, politique de formatage, huit reçus incorrects délibérément créés (un par règle de réconciliation)
- `schemas/receipt.v0.1.0.json` — schéma JSON du reçu (fermé, avec des annotations `x-order` pour le formatage canonique)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — la pile de règles, le mécanisme anti-circularité, la doctrine des reçus incorrects précédant les reçus corrects
- [`SECURITY.md`](./SECURITY.md) — ce qui constitue une vulnérabilité pour un vérificateur

## Licence

MIT — voir `LICENSE`.
