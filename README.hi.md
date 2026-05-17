<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

# @mcptoolshop/backprop-trace

एक नियतात्मक प्रशिक्षण-ट्रेस इंजन — यह एकल बैकप्रॉप चरणों के मानक JSONL रिकॉर्ड बनाता है, जिसकी पुष्टि 8 नियमों वाले एक सत्यापनकर्ता (reconciler) द्वारा की जाती है (सभी 8 नियम v0.2 में जोड़े गए हैं)।

## backprop-trace क्यों?

यदि आप न्यूरल नेटवर्क के प्रशिक्षण को सिखाते हैं, ऑडिट करते हैं या सत्यापित करते हैं, तो आपको एक ऐसे तरीके की आवश्यकता होती है जिससे आप कह सकें कि "यह ट्रेस सही है"। backprop-trace एकल बैकप्रॉप चरणों के मानक बाइट-स्तरीय रिकॉर्ड और एक सत्यापनकर्ता बनाता है जो नामित कारकों से प्रत्येक मान को पुनः प्राप्त करता है। v0.1 में "माज़ुर 2-2-2" फिक्स्चर शामिल है — यह ओपन वेब पर सबसे अधिक उद्धृत शिक्षण बैकप्रॉप उदाहरण है — जो एक बाइट-समान प्रतिगमन आधार रेखा के रूप में कार्य करता है, साथ ही एक "एंटी-सर्किलेरिटी" खराब फिक्स्चर भी है जो यह साबित करता है कि सत्यापनकर्ता उन चीज़ों को अस्वीकार करता है जिन्हें उसे अस्वीकार करना चाहिए।

यह **कोई** एमएल मेट्रिक्स लॉगर नहीं है (इसके लिए MLflow / W&B / TensorBoard का उपयोग करें)। यह प्रूफ-ऑफ-लर्निंग (Jia et al. IEEE S&P 2021) की श्रृंखला में एक संरचनात्मक-ट्रेस सत्यापनकर्ता है, जो शिक्षण के एकल-चरण उदाहरणों तक सीमित है — यूनिट-टेस्ट पैमाने पर, पूर्ण प्रशिक्षण रन पैमाने पर नहीं।

## 30 सेकंड में शुरुआत

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

अधिक विस्तृत जानकारी के लिए, [`docs/quickstart.md`](./docs/quickstart.md) देखें; CLI संदर्भ के लिए, [`docs/cli.md`](./docs/cli.md); और प्रमाणीकरण पथ के लिए, [`docs/attestation.md`](./docs/attestation.md)।

## इंस्टॉल करें

```
pnpm add @mcptoolshop/backprop-trace
```

या npm के साथ:

```
npm install @mcptoolshop/backprop-trace
```

## CLI का उपयोग

v0.2 में चार उप-कमांड शामिल हैं। पूर्ण संदर्भ: [`docs/cli.md`](./docs/cli.md)।

```
bp reconcile receipt <file>     Reconcile a receipt against the 8 rules.
bp verify mazur [<file>]        Full gate: schema + reconcile + engine-reproduce + byte-equal + drift.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp validate <file>              Schema-only validation.
```

सामान्य ध्वज (पूर्ण संदर्भ के लिए [`docs/cli.md`](./docs/cli.md)):

- `--json` — मशीन-पठनीय JSON आउटपुट (CI उपभोक्ता)।
- `--verbose`, `-V` — रन से पहले नैदानिक stderr।
- `--color=auto|never|always` — रंगीन आउटपुट; `NO_COLOR` का सम्मान करता है।
- फ़ाइल तर्क `-` stdin से पढ़ता है (`reconcile receipt`, `validate`, `verify mazur`)।

एग्जिट कोड: 0 पास, 1 सत्यापन विफलता, 2 I/O / गलत इनपुट, 3 अमान्य CLI तर्क।

`bp --version` और `bp --help` बिना किसी उप-कमांड के काम करते हैं; `bp <subcommand> --help` उप-कमांड-विशिष्ट उपयोग दिखाता है।

## लाइब्रेरी का उपयोग

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

इन-टोटो v1 मैपिंग के लिए [`docs/attestation.md`](./docs/attestation.md) देखें।

उप-पथ आयात निर्यात किए जाते हैं (`./reconcile`, `./engine`, `./mazur`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`)।

## यह क्या है

एक *संरचनात्मक-ट्रेस सत्यापनकर्ता* जिसमें मानक बाइट-स्तरीय एन्कोडिंग है। रिकॉर्ड एक अनुबंध है; सत्यापनकर्ता प्रत्येक दावे की जांच करता है जो एक रिकॉर्ड करता है और यह सुनिश्चित करता है कि गणित सही है।

संदर्भ वर्ग:

- प्रूफ-ऑफ-लर्निंग (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) "खराब-रिकॉर्ड पहले, अच्छे बाद में" सिद्धांत के लिए।

यह zkML नहीं है (कोई क्रिप्टोग्राफिक संक्षिप्तता नहीं)। यह opML भी नहीं है (कोई धोखाधड़ी-सबूत गेम नहीं)। यह कोई एमएल मेट्रिक्स लॉगर भी नहीं है — backprop-trace बाइनरी फ्लोट्स के बजाय दशमलव स्ट्रिंग लिखता है; यह Jest स्नैपशॉट / Rust insta के समान है।

## नियतात्मक दायरा

V8/Node 22 ULP एनवेलप के भीतर 9-अंक परिशुद्धता वाला ट्रेस। पिन किए गए इंजन मान V8 पर स्केलर IEEE 754 डबल मानों को मानते हैं।

अन्य इंजनों (Hermes, JSC, Bun-JSC) के साथ पोर्टेबिलिटी का परीक्षण **नहीं** किया गया है। व्यापक रूप से उद्धृत डाउनस्ट्रीम एंकर `0.291027924` इंजन मान `0.29102777369359933` से लगभग 1.5e-7 से भिन्न होता है; विचलन के रिकॉर्ड के लिए `fixtures/mazur.published.json` देखें।

v0.1 Node 22.x पर पिन किया गया है।

## आठ नियम

1. आउटपुट त्रुटि संकेत की स्थिरता
2. डाउनस्ट्रीम योगदान और बैकप्रोपैगेटेड योग
3. छिपे हुए त्रुटि संकेत की स्थिरता
4. अपडेट ग्रेडिएंट की स्थिरता
5. अपडेट मान की स्थिरता
6. भार का विकास
7. अंतिम अवस्था की स्थिरता
8. उत्पत्ति संदर्भ की स्थिरता

सभी 8 नियम v0.2 में लागू किए गए हैं (नियम 4 मूल रूप से v0.1 में शामिल किया गया था)। सभी नियमों का विस्तृत विवरण [`docs/reconciliation.md`](./docs/reconciliation.md) में दिया गया है; प्रत्येक नियम के साथ एक जानबूझकर गलत `fixtures/bad/mazur.bad-<kind>.jsonl` फ़ाइल भी शामिल है, जो Csmith के सिद्धांत के अनुसार है।

## कानूनी ढांचा

`docs/canonical-emission.md` से:

> अनुबंध इंजन से पहले आता है। फ़ॉर्मेटर नीति रनटाइम फ़ॉर्मेटिंग से पहले आती है। खराब रसीदें अच्छी रसीदों से पहले आती हैं। रनटाइम फ़ॉर्मेटिंग माज़ुर से पहले आती है। माज़ुर निदान से पहले आता है।

## v0.2 का दायरा

- केवल माज़ुर 2-2-2 टोपोलॉजी
- केवल सिंगल-स्टेप प्रशिक्षण
- केवल सिग्मॉइड सक्रियण + हाफ-स्क्वायर्ड-एरर (MSE) हानि
- प्रति-लेयर बायस
- SGD ऑप्टिमाइज़र (कोई मोमेंटम नहीं, कोई एडम नहीं, कोई वेट डीके नहीं)
- केवल CPU (GPU के लिए कोई निश्चितता का दावा नहीं)
- केवल V8 / Node 22.x

मल्टी-स्टेप प्रशिक्षण, सामान्यीकृत टोपोलॉजी, वैकल्पिक सक्रियण/हानि, और अधिक उन्नत ऑप्टिमाइज़र v0.3+ के लिए आरक्षित हैं (v0.2 में क्या शामिल है, यह जानने के लिए [`CHANGELOG.md`](./CHANGELOG.md) देखें)।

## लिंक

- [`docs/quickstart.md`](./docs/quickstart.md) — पांच मिनट का परिचय
- [`docs/cli.md`](./docs/cli.md) — `bp` सबकमांड संदर्भ (v0.2+)
- [`docs/reconciliation.md`](./docs/reconciliation.md) — आठ पुनर्संयोजन नियम
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — बाइट-लेवल एन्कोडिंग अनुबंध
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 ऑर्डरिंग नियम; FMA निषेध
- [`docs/schema.md`](./docs/schema.md) — रसीद स्कीमा का फ़ील्ड-दर-फ़ील्ड विवरण
- [`docs/attestation.md`](./docs/attestation.md) — इन-टोटो v1 प्रमाणन
- `fixtures/` — मानक, मैन्युअल रूप से तैयार किए गए प्रकाशित लेज़र, फ़ॉर्मेटर नीति, आठ जानबूझकर गलत "bad-" रसीदें (प्रत्येक पुनर्संयोजन नियम के लिए एक)
- `schemas/receipt.v0.1.0.json` — रसीद JSON स्कीमा (बंद, जिसमें `x-order` एनोटेशन हैं जो मानक उत्सर्जन को चलाते हैं)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — कानूनी ढांचा, एंटी-सर्कुलैरिटी रैटचेट, "खराब रसीदें अच्छी रसीदों से पहले" का सिद्धांत
- [`SECURITY.md`](./SECURITY.md) — सत्यापनकर्ता के लिए क्या भेद्यता माना जाता है

## लाइसेंस

MIT — `LICENSE` देखें।
