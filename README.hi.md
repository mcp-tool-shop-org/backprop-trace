<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

एक नियतात्मक संरचनात्मक-ट्रेस सत्यापनकर्ता, जो एकल न्यूरल-नेटवर्क प्रशिक्षण चरणों के लिए है - यह 16 नियमों वाला एक 'रिकॉन्सिलर' है, जो नामित कारकों से ग्रेडिएंट, सिग्नल और पैरामीटर अपडेट को फिर से प्राप्त करता है, और 'कैनाॅनिकल' बाइटवाइज JSONL रसीदें उत्पन्न करता है। यह Csmith/CompCert की उस विचारधारा का अनुसरण करता है: *"ओरेकल को उस कलाकृति से परामर्श नहीं करना चाहिए जिसका वह मूल्यांकन करता है।"*

**स्थिति: मिड-v0 (v0.7.0)।** मुख्य इंजन और रिकॉन्सिलर वास्तविक हैं और उपलब्ध हैं। यह सिंगल-स्टेप, केवल CPU, केवल SGD, और सिंगल-सैंपल पर काम करता है। वर्तमान में, बाहरी फ्रेमवर्क ट्रेस मैन्युअल रूप से बनाए जाते हैं। उत्पादन कार्यों के लिए इसे उपयोग करने से पहले, [इस संस्करण में क्या नहीं है](#whats-not-in-this-version-yet) अनुभाग को अवश्य देखें।

## 30 सेकंड में शुरुआत कैसे करें

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

Mazur 2-2-2, ओपन वेब पर सबसे अधिक उद्धृत सिंगल-स्टेप बैकप्रोपगेशन विवरण है (मैट माज़ुर, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)। यह एक महत्वपूर्ण उदाहरण है क्योंकि इसमें मौजूद प्रत्येक संख्या को मैन्युअल रूप से प्राप्त किया जा सकता है। अपने स्वयं के ट्रेस के लिए, [अपना प्रशिक्षण ट्रेस जोड़ें](#bring-your-own-training-trace) अनुभाग देखें।

## यह क्या है

backprop-trace एक संख्यात्मक-सटीकता सत्यापनकर्ता है, जो *एक* न्यूरल-नेटवर्क प्रशिक्षण चरण के लिए है। आप इसे एक रसीद देते हैं - एक JSONL रिकॉर्ड जो प्रत्येक कारक को सूचीबद्ध करता है जिसने एक एकल ग्रेडिएंट अपडेट में योगदान दिया - और रिकॉन्सिलर 16 नियमों का पालन करता है जो नामित कारकों से प्रत्येक दावे को फिर से प्राप्त करता है। यदि कोई भी नियम हाइब्रिड सहनशीलता (`atol + rtol`, सममित अधिकतम रूप) के भीतर असहमत होता है, तो रसीद को अस्वीकार कर दिया जाता है।

इसकी आधारशिला Csmith (यांग, चेन, एइड, रेगेहर — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) और CompCert (लेरॉय, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)) हैं: प्रतिकूल डेटासेट एक सत्यापनकर्ता को प्रमाणित करते हैं, परीक्षण पास करने से नहीं। प्रत्येक रिकॉन्सिलर नियम के साथ एक जानबूझकर गलत उदाहरण (`fixtures/bad/`) शामिल है, जिसे सत्यापनकर्ता को किसी भी `fixture_status` लाइफसाइकिल मेटाडेटा को पढ़ने से पहले अस्वीकार करना चाहिए। यह 'एंटी-सर्किअलरिटी' अनुशासन - ओरेकल को उस कलाकृति से परामर्श नहीं करना चाहिए जिसका वह मूल्यांकन करता है - इसकी मुख्य विशेषता है।

## यह क्या नहीं है

- **यह कोई प्रयोग ट्रैकर नहीं है।** यदि आप लॉस कर्व, डैशबोर्ड या दीर्घकालिक रन स्टोरेज चाहते हैं, तो [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), या [TensorBoard](https://www.tensorflow.org/tensorboard) का उपयोग करें। ये लॉग करते हैं कि ट्रेनर ने क्या दावा किया है। backprop-trace यह फिर से प्राप्त करता है कि क्या गणित आंतरिक रूप से सुसंगत है। ये पूरक हैं, ओवरलैपिंग नहीं।
- **यह प्रूफ-ऑफ-लर्निंग या zkML नहीं है।** PoL (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) को वास्तविक प्रशिक्षण पर 'फोर्ज' करने योग्य दिखाया गया है (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)। zkML/opML (EZKL, Modulus, ORA) ट्रस्टलेस ऑन-चेन निपटान के लिए क्रिप्टोग्राफिक या आर्थिक रूप से समर्थित प्रमाण उत्पन्न करते हैं। backprop-trace गैर-क्रिप्टोग्राफिक, सिंगल-स्टेप है, और इसका लक्षित दर्शक एक मानव या CI समीक्षक है।
- **यह सप्लाई-चेन प्रमाणीकरण नहीं है।** [Sigstore मॉडल-साइनिंग](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), और [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) प्रमाणित करते हैं कि *कलाकृति X का उत्पादन पाइपलाइन Y द्वारा किया गया था*। backprop-trace प्रमाणित करता है कि *यह अपडेट इन कारकों से गणितीय रूप से प्राप्त किया जा सकता है*। यह पूरक है - एक ML-BOM एक backprop-trace रसीद को एक आंतरिक-संगति शर्त के रूप में संदर्भित कर सकता है।

## खतरे का मॉडल

`backprop-trace` एक नियतात्मक सत्यापनकर्ता है: इसके दायरे में कोई भी ऐसा रसीद शामिल है जिसे अस्वीकार किया जाना चाहिए, लेकिन स्वीकार कर लिया गया है - स्कीमा बाईपास, NaN/अनंत विषाक्तता, मानक उत्सर्जन विचलन, एंटी-चक्रीयता उल्लंघन (सत्यापनकर्ता द्वारा नियम जांच पूरी करने से पहले `fixture_status` की जांच करना), और आयातित फ्रेमवर्क ट्रेस पर इंजन-रीकंप्यूट असहमति। इसके दायरे से बाहर प्रशिक्षण रन की विश्वसनीयता, प्रशिक्षित मॉडल की शुद्धता, सत्यापनकर्ता प्रक्रिया के खिलाफ साइड-चैनल या टाइमिंग हमले, और रसीद स्वीकृति निर्णय से परे कुछ भी शामिल है। नियतात्मकता सीमित है: बाइट-समान आउटपुट केवल समान `backprop-trace` संस्करण, समान Node.js प्रमुख संस्करण (वर्तमान में 22.x), और समान मानक उत्सर्जन विनिर्देश संस्करण में ही गारंटीकृत है। विभिन्न इंजन (Hermes, JSC, Bun-JSC) और विभिन्न Node.js प्रमुख संस्करणों (24.x, 26.x, ...) के बीच पुनरुत्पादन एक लक्ष्य नहीं है। सत्यापनकर्ता रसीद प्रारूप और मानक उत्सर्जन अनुबंध पर भरोसा करता है; यह निर्माता पर भरोसा नहीं करता है। प्रकटीकरण समयरेखा, गंभीरता मानदंड और पूर्ण विवरण के लिए [SECURITY.md](./SECURITY.md) देखें।

## स्थापना

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Node 22.x पर पिन किया गया (V8 fdlibm `Math.exp` नियतात्मकता महत्वपूर्ण है - [`docs/computation-order.md`](./docs/computation-order.md) देखें)।

## CLI उपयोग

v0.7 में 16 उप-कमांड हैं। पूर्ण संदर्भ: [`docs/cli.md`](./docs/cli.md)।

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

सामान्य ध्वज ([`docs/cli.md`](./docs/cli.md) देखें):

- `--out <file>` — stdout के बजाय फ़ाइल में लिखें
- `--json` — मशीन-पठनीय JSON आउटपुट (CI उपभोक्ता)
- `--verbose`, `-V` — रन से पहले नैदानिक stderr
- `--color=auto|never|always` — रंगीन आउटपुट; `NO_COLOR` का सम्मान करता है
- फ़ाइल तर्क `-` stdin से पढ़ता है (`रसीद का मिलान करें`, `सत्यापित करें`, `सामान्य सत्यापन`)

निकास कोड: `0` पास · `1` सत्यापन विफलता · `2` उपयोग या I/O त्रुटि · `3` अमान्य CLI तर्क · `4` फ्रेमवर्क लागू नहीं है।

## लाइब्रेरी उपयोग

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

उप-पथ आयात: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (टोपोलॉजी-इनपुट), `./schema/framework-trace-0.1.0`.

## अपना प्रशिक्षण ट्रेस लाएं

v0.6 का बाहरी-ग्रहण पथ PyTorch / JAX / TensorFlow उपयोगकर्ताओं को समान 16 नियमों के खिलाफ अपने स्वयं के एकल-चरण `backprop` ट्रेस को सत्यापित करने की अनुमति देता है - लेकिन **आज साइडकार मैन्युअल रूप से लिखा गया है**। अभी तक `pip install backprop-trace-pytorch` जैसा कोई सहायक उपकरण नहीं है। साइडकार बनाने के लिए:

1. [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) स्कीमा पढ़ें - यह एक प्रशिक्षण चरण (टोपोलॉजी + इनपुट + फॉरवर्ड + ग्रेडिएंट + पैरामीटर_से पहले + पैरामीटर_बाद में + उत्पत्ति) के लिए JSONL अनुबंध को परिभाषित करता है।
2. अपने प्रशिक्षण चरण से उन मानों को निकालें (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape` - सभी आवश्यक प्रति-टेन्सर संख्यात्मक मान प्रदान करते हैं)।
3. साइडकार को मानक JSONL के रूप में उत्सर्जित करें (दशमलव स्ट्रिंग, बाइनरी फ्लोट नहीं - [`docs/canonical-emission.md`](./docs/canonical-emission.md) देखें)।
4. `bp import pytorch <sidecar.jsonl>` (या `import jax` / `import tensorflow`) चलाएं।
5. इम्पोर्टर एक **ऑब्जर्वर-मोड रसीद** उत्पन्न करता है: फ्रेमवर्क के दावे मानक फ़ील्ड के रूप में मौजूद होते हैं; `backprop-trace` इंजन उसी चरण को फिर से गणना करता है और **नियम 14** को एक विभेदक जांच के रूप में चलाता है। असहमति = या तो आपका एक्सट्रैक्टर झूठ बोल रहा था, या आपके फ्रेमवर्क में बदलाव आया है, या ट्रेस में कुछ गलत है।

यह आज एक वास्तविक कार्यप्रवाह है, लेकिन यह जटिल है। लाइव-सहायक पैकेजिंग अंतराल के लिए [इस संस्करण में क्या नहीं है (अभी तक)](#whats-not-in-this-version-yet) देखें।

प्रत्येक फ्रेमवर्क के लिए विशिष्ट उप-कमांड का अनुपालन लागू किया जाता है: `bp import pytorch` JAX साइडकार को अस्वीकार करता है और इसके विपरीत। कोई स्वचालित पहचान नहीं (इस पैकेज में कोई लाइव फ्रेमवर्क रनटाइम निर्भरता नहीं है - जानबूझकर)।

## 16 नियम

| # | नियम |
|---|---|
| 0 | संरचनात्मक विफलता संकेतक (स्कीमा-स्तर) |
| 0.8 | संभाव्यता सीमाएं - सॉफ्टमैक्स आउटपुट [0, 1] में |
| 1 | आउटपुट त्रुटि संकेत की स्थिरता |
| 2 | डाउनस्ट्रीम योगदान और बैकप्रोपैगेटेड योग |
| 3 | छिपे हुए त्रुटि संकेत की स्थिरता |
| 4 | अपडेट ग्रेडिएंट की स्थिरता |
| 5 | अपडेट मान की स्थिरता |
| 6 | वजन का विकास |
| 7 | अंतिम स्थिति की स्थिरता |
| 8 | उत्पत्ति संदर्भ की स्थिरता |
| 9 | मल्टी-स्टेप पैरामीटर श्रृंखला (`parameters_before[N]` = पिछला `parameters_after[N-1]`) |
| 10 | मल्टी-स्टेप ट्रेस पहचान (साझा `trace_id` + अनुक्रमिक `step_index`) |
| 11 | सॉफ्टमैक्स सामान्यीकरण (`sum(forward[output].out) == 1.0`) |
| 12 | हानि सूत्र की स्थिरता (आधा-वर्ग-त्रुटि + क्रॉस-एंट्रॉपी-सॉफ्टमैक्स शाखाएं) |
| 13 | द्वि-रूप स्थिरता (सॉफ्टमैक्स+सीई जैकोबियन अपघटन; गेटेड - केवल तभी सक्रिय होता है जब `dual_form` मौजूद हो) |
| 14 | इंजन-रीकंप्यूट विभेदक (पर्यवेक्षक-मोड में आयातित प्राप्तियों के लिए अनिवार्य) |
| 15 | स्किप-आधार की आवश्यकता (बंद एनम `EXTERNAL_TRUST_BASIS`, 4 मान) |
| 16 | अटेस्टेशन डाइजेस्ट बाइंडिंग (गेटेड - सक्रिय होता है जब `attestor.signed_subject_digest` मौजूद हो) |

पूर्ण विवरण [`docs/reconciliation.md`](./docs/reconciliation.md) में। प्रत्येक नियम में एक संबंधित खराब फिक्सचर `fixtures/bad/` में होता है, जो Csmith सिद्धांत के अनुसार है।

## नियति का दायरा

पिन किए गए मैट्रिक्स (नोड 22.x × {उबंटू, मैकओएस, विंडोज} × बैकप्रोप-ट्रेस 0.7.x) पर क्या अनुबंध है:

- `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl` के बाइट-बराबर
- बंडल किए गए फ्रेमवर्क साइडकार के लिए बाइट-बराबर बाहरी गोल्डन्स: `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- माज़ुर 2-2-2 एंकर: `post_update_loss.total = 0.29102777369359933` (विस्तृत रूप से उद्धृत डाउनस्ट्रीम `0.291027924` के विपरीत - बहाव ~1.5e-7; लेजर के लिए `fixtures/mazur.published.json` देखें)
- प्रत्येक नियम के लिए हाइब्रिड सहनशीलता के भीतर पुनर्संयोजन (`atol = 1e-12`, `rtol = 1e-9` इंजन द्वारा निर्मित के लिए; जहां गणित सटीक है वहां अधिक सख्त)

क्या अनुबंध में नहीं है:

- क्रॉस-इंजन (बुन, डेनो, ब्राउज़र) - विभिन्न `Math.exp` कार्यान्वयन
- क्रॉस-नोड-मेजर (24.x, 26.x, ...) - V8 fdlibm पोर्ट को संशोधित किया जा सकता है
- मनमाना V8 माइनर बंप - ECMA-262 §21.3 `Math.exp` परिशुद्धता को कार्यान्वयन-परिभाषित छोड़ देता है
- `Math.exp` के माध्यम से बहने वाले मानों की बिट-स्थिरता (सिग्मॉइड, टैनएच, सॉफ्टमैक्स) V8 संस्करणों में

एक `Math.exp(-0.5)` कैनरी प्रत्येक CI सेल पर चलता है, जो V8 fdlibm बहाव के लिए एक प्रारंभिक चेतावनी संकेत है। विफलता का मतलब है "V8 परिवर्तन लॉग की जांच करें," न कि "इंजन बग।"

## इस संस्करण में क्या नहीं है (अभी तक)

backprop-trace v0.7.0 एक **मिड-v0 उत्पाद** है। मुख्य इंजन, पुनर्संयोजक, मानक-उत्सर्जन अनुबंध और बाहरी-ग्रहण पथ वास्तविक और स्थिर हैं। लेकिन कई चीजें जो v1.0 सत्यापनकर्ता को चाहिए, वे अभी तक इसमें नहीं हैं:

- **मल्टी-स्टेप ऑब्जर्वर-मोड रसीदें।** वर्तमान में, बाहरी डेटा का उपयोग एक चरण में किया जाता है। वास्तविक प्रशिक्षण में हजारों चरण शामिल होते हैं। *अगला लक्ष्य: v0.8।*
- **वैनिला SGD से बेहतर ऑप्टिमाइज़र।** इसमें एडम, एडमडब्ल्यू, मोमेंटम या वेट डिके जैसी चीजें शामिल नहीं हैं। 2026 में वास्तविक मशीन लर्निंग प्रशिक्षण में, अधिकांशतः एडम का उपयोग होता है; केवल SGD का उपयोग एक बड़ी सीमा है। *रोडमैप लक्ष्य: v0.9।*
- **बैच आयाम।** वर्तमान में, यह एक नमूने तक सीमित है। वास्तविक PyTorch/JAX/TF प्रशिक्षण में बैच का उपयोग किया जाता है। एक उपयोगकर्ता जो वास्तविक प्रशिक्षण चरण का उपयोग कर रहा है, वह इसे सीधे आयात नहीं कर सकता क्योंकि उसे प्रत्येक नमूने के लिए मैन्युअल रूप से प्रक्रिया करनी होगी। *रोडमैप लक्ष्य: v0.9।*
- **लाइव फ्रेमवर्क सहायक उपकरण।** वर्तमान में, ये सहायक उपकरण मैन्युअल रूप से बनाए जाते हैं; कोई `pip install backprop-trace-pytorch` पैकेज नहीं है, और कोई `scripts/python-helpers/dump_pytorch_trace.py` जैसा तैयार-से-उपयोग करने वाला एक्सट्रैक्टर भी नहीं है। "मेरे पास एक PyTorch चरण है" से "मेरे पास एक रसीद है" तक का रास्ता बहुत लंबा है। *रोडमैप लक्ष्य: v0.10।*
- **वास्तविक दुनिया का उदाहरण।** "हीरो" माज़ुर 2-2-2 शैक्षणिक उदाहरण है। v1.0 सत्यापनकर्ता में कम से कम एक पहचानने योग्य आर्किटेक्चर (छोटा CNN फॉरवर्ड+बैकवर्ड, छोटा ट्रांसफॉर्मर ब्लॉक) होना चाहिए। *रोडमैप लक्ष्य: v0.11।*
- **उपयोगकर्ता सत्यापन।** इसमें कोई बाहरी शोधकर्ता केस स्टडी नहीं है, कोई ऐसा पाठ्यक्रम नहीं है जो इसे शिक्षण के लिए उपयोग कर रहा है, और कोई अनुपालन इंजीनियर भी नहीं है जिसने इसका उपयोग ऑडिट बंडल के लिए किया हो। *रोडमैप लक्ष्य: v1.0 के किसी भी प्रचार से पहले।*
- **GPU का निश्चित व्यवहार।** यह दायरे से बाहर है (और संभवतः ऐसा ही रहेगा - cuDNN ConvolutionBackwardFilter एटॉमिक्स रन के बीच बिट-सटीक परिणाम को प्रभावित करते हैं, [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/))। उत्पाद की स्थिति: CPU पर निश्चित व्यवहार।

यदि आपकी कार्यप्रणाली इनमें से किसी पर भी निर्भर है, तो यह संस्करण अभी आपके लिए सही नहीं है।

## कस्टम टोपोलॉजी बनाना

JSON कॉन्फ़िगरेशन से इंजन चलाएं - TypeScript में कोई बदलाव आवश्यक नहीं:

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

विस्तृत जानकारी के लिए [`docs/authoring.md`](./docs/authoring.md) देखें - इनपुट बनाम रसीद स्कीमा, और विश्वसनीय उत्सर्जन सीमा।

## यह कहां फिट बैठता है

- **पुनरुत्पादन-प्रथम पेपर के लेखक** (NeurIPS/ICML/CoLLAs के लिए सामग्री प्रस्तुत करने वाले; REFORMS से परिचित शोधकर्ता - कपूर एट अल., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) - समीक्षक 30 सेकंड में प्रत्येक चरण के लिए पुनः प्राप्त करने योग्य प्रमाण प्राप्त कर सकते हैं।
- **मशीन लर्निंग शिक्षण** (करापाथी ज़ीरो-टू-हीरो, विश्वविद्यालय के डीएल पाठ्यक्रम, एमएल सिस्टम साक्षात्कार की तैयारी) - प्रत्येक कारक के साथ एक नामित प्रशिक्षण चरण, और एक ऐसा उपकरण जो जानबूझकर गलत किए गए उदाहरणों को *अस्वीकार* करता है।
- **मशीन लर्निंग फ्रेमवर्क / कंपाइलर इंजीनियर** (PyTorch / JAX / MLIR / XLA योगदानकर्ता) - विभेदक परीक्षण के लिए नए कंपाइलर आउटपुट के विरुद्ध एक ज्ञात-अच्छे प्रति-ऑप ट्रेस उत्पन्न करें।
- **मशीन लर्निंग अनुपालन / ऑडिट इंजीनियर** (EU AI Act Article 10 के कार्यान्वयनकर्ता, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML उपभोक्ता) - मॉडल हस्ताक्षर से नीचे एक प्रति-चरण रसीद प्रारूप, जो मॉडल कार्ड या ऑडिट बंडल से जुड़ा होता है।

## संदर्भ वर्ग

- **लर्निंग का प्रमाण (Proof-of-Learning) की श्रृंखला:** जिया एट अल. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) - संरचनात्मक विचार के लिए; फांग एट अल. (EuroS&P 2023) - इस चेतावनी के लिए कि PoL व्यवहार में जाली बनाया जा सकता है। बैकप्रोप-ट्रेस (backprop-trace) केवल एक-चरण सीपीयू सत्यापन तक सीमित है, जो कि नियतिशीलता प्राप्त करने योग्य है।
- **REFORMS:** कपूर एट अल. (*साइंस एडवांसेज* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) - 32-आइटम एमएल (ML) पुनरुत्पादकता जांच सूची; प्रत्येक चरण के प्रमाण, रसीद-शैली, आइटम 24-30 पर लागू होते हैं।
- **Csmith + CompCert सिद्धांत:** यांग एट अल. (PLDI 2011) और लेरोय (CACM 2009) - प्रतिकूल डेटासेट एक सत्यापनकर्ता को प्रमाणित करते हैं; सत्यापनकर्ता को उस कलाकृति से परामर्श नहीं करना चाहिए जिसका वह मूल्यांकन करता है।
- **सप्लाई-चेन प्रमाणीकरण:** इन-टोटो v1, SLSA Provenance v1.0, सिग्स्टोर मॉडल-पारदर्शिता ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) - बैकप्रोप-ट्रेस रसीदें डीएसएसई (DSSE) स्टेटमेंट के विषय के रूप में उपयोग की जा सकती हैं।

यह zkML (कोई क्रिप्टोग्राफिक संक्षिप्तता नहीं) नहीं है। यह opML (कोई धोखाधड़ी-प्रूफ गेम नहीं) नहीं है। यह एमएल मेट्रिक्स लॉगर भी नहीं है - बैकप्रोप-ट्रेस बाइनरी फ्लोट्स के बजाय दशमलव स्ट्रिंग लिखता है; यह जेस्ट स्नैपशॉट/रस्ट इंस्टा के समान है।

## कानून का ढेर (The law stack)

`docs/canonical-emission.md` से:

> अनुबंध इंजन से पहले आता है। फ़ॉर्मेटर नीति रनटाइम फ़ॉर्मेटिंग से पहले आती है। खराब रसीदें अच्छी रसीदों से पहले आती हैं। रनटाइम फ़ॉर्मेटिंग माज़ुर से पहले आती है। माज़ुर निदान से पहले आता है।

## लिंक

- [`docs/quickstart.md`](./docs/quickstart.md) - पांच मिनट का परिचय
- [`docs/cli.md`](./docs/cli.md) - `bp` सबकमांड संदर्भ
- [`docs/authoring.md`](./docs/authoring.md) - कस्टम टोपोलॉजी बनाएं
- [`docs/reconciliation.md`](./docs/reconciliation.md) - 16 पुनर्संयोजन नियम
- [`docs/topology.md`](./docs/topology.md) - सामान्य टोपोलॉजी निर्माण
- [`docs/multi-step.md`](./docs/multi-step.md) - मल्टी-स्टेप प्रशिक्षण रसीदें (इंजन द्वारा निर्मित)
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) - बाइट-लेवल एन्कोडिंग अनुबंध
- [`docs/computation-order.md`](./docs/computation-order.md) - IEEE 754 ऑर्डरिंग; एफएमए निषेध; हाइब्रिड सहनशीलता; नियतिशीलता सीमा
- [`docs/schema.md`](./docs/schema.md) - फ़ील्ड-दर-फ़ील्ड स्कीमा विवरण
- [`docs/attestation.md`](./docs/attestation.md) - इन-टोटो v1 प्रमाणीकरण
- `fixtures/` - कैनोनिकल गोल्डन्स (माज़ुर, XOR, प्रति-न्यूरॉन-बायस XOR, आइरिस, सॉफ्टमैक्स-सीई, मल्टी-स्टेप XOR), बाहरी साइडकार + ऑब्जर्वर-मोड गोल्डन्स (पायटॉर्च, जैक्स, टेंसरफ्लो), जानबूझकर खराब की गई बैड-* रसीदें (प्रत्येक पुनर्संयोजन नियम के लिए एक)
- `schemas/` - रसीद v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, टोपोलॉजी-इनपुट v0.4.0, फ्रेमवर्क-ट्रेस v0.1.0 (सभी बंद, `x-order` एनोटेटेड, योगात्मक)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - कानून का ढेर, एंटी-सर्कुलैरिटी रैट्चेट, बैड-रसीद्स-प्रीसीड-गुड सिद्धांत
- [`SECURITY.md`](./SECURITY.md) - सत्यापनकर्ता के लिए क्या भेद्यता मानी जाती है
- [`CHANGELOG.md`](./CHANGELOG.md) - संस्करण-दर-संस्करण इतिहास

## लाइसेंस

एमआईटी (MIT) - `LICENSE` देखें।
