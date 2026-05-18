<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

न्यूरल नेटवर्क प्रशिक्षण के चरणों के लिए एक नियतात्मक 26-नियम सत्यापनकर्ता। आप इसे एक रसीद देते हैं जिसमें उन सभी कारकों का उल्लेख होता है जिन्होंने एक ग्रेडिएंट अपडेट में योगदान दिया; सत्यापनकर्ता प्रत्येक दावे को फिर से प्राप्त करता है और असहमति होने पर उसे अस्वीकार कर देता है। यह Csmith/CompCert की उस पंक्ति का अनुसरण करता है कि *"ऑरेकल को उस कलाकृति से परामर्श नहीं करना चाहिए जिसका वह मूल्यांकन करता है।"*

> **स्थिति: मिड-v0 (v0.11.0) — पहला प्रकाशित संस्करण।** केवल CPU। सत्यापनकर्ता SGD + Adam + AdamW + PyTorch-शैली SGD मोमेंटम (क्लासिक + नेस्टेरोव + डैम्पनिंग) को कवर करता है।
> लाइव PyTorch सहायक (`scripts/extract/pytorch.py`) समान ऑप्टिमाइज़र मैट्रिक्स को कवर करता है। केवल पर्यवेक्षक — [नियम 14](./docs/reconciliation.md) प्राधिकारी है।
> v0.11 पहली npm-प्रकाशित रिलीज़ है; v1.0 अभी भी [वास्तविक दुनिया के उदाहरण + अपनाने वाले सत्यापन + मल्टी-फ्रेमवर्क लाइव सहायक](#whats-not-in-this-version-yet) पर निर्भर है। उत्पादन में उपयोग करने से पहले [`docs/live-helpers.md`](./docs/live-helpers.md) देखें।

## 30 सेकंड में शुरुआत कैसे करें

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

माज़ुर 2-2-2, ओपन वेब पर सबसे अधिक उद्धृत सिंगल-स्टेप बैकप्रोप मार्गदर्शिका है ([मैट माज़ुर, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/))। इसमें मौजूद प्रत्येक संख्या को हाथ से प्राप्त किया जा सकता है।

## यह क्या है

एक प्रशिक्षण चरण के लिए संख्यात्मक-सटीकता सत्यापनकर्ता। सत्यापनकर्ता 26 नियमों का पालन करता है जो नामित कारकों से प्रत्येक दावे को फिर से प्राप्त करता है। यदि कोई भी नियम हाइब्रिड सहनशीलता (`atol + rtol`) के भीतर असहमति दिखाता है, तो रसीद को अस्वीकार कर दिया जाता है। मल्टी-स्टेप (नियम 9 + 10), बैच (नियम 18 + 19), एडम मोमेंट पुनरावृत्ति (नियम 22-24), SGD मोमेंट पुनरावृत्ति (नियम 20 + 21a/21b/21c + 25 + 26), और आयातित फ्रेमवर्क ट्रेस पर इंजन-रीकंप्यूट विभेदक (नियम 14) उत्पादन-प्रासंगिक पहलुओं को कवर करते हैं।

यह **सत्यापित नहीं करता है** कि संपूर्ण प्रशिक्षण रन सही है, यह साबित नहीं करता है कि मॉडल सही है, और यह किसी प्रयोग ट्रैकर को प्रतिस्थापित नहीं करता है। यह साबित करता है कि प्रत्येक दर्ज किया गया चरण गणितीय रूप से सुसंगत है और श्रृंखला बरकरार है। प्रतिकूल कॉर्पोरा एक सत्यापनकर्ता को साबित करते हैं ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — प्रत्येक नियम के साथ [`fixtures/bad/`](./fixtures/bad) के तहत एक जोड़ी खराब उदाहरण होता है जिसे सत्यापनकर्ता को किसी भी `fixture_status` मेटाडेटा को पढ़ने से पहले अस्वीकार करना चाहिए।

## लाइव PyTorch सहायक (v0.10+)

एकल ऑडिट करने योग्य पायथन फ़ाइल। डिफ़ॉल्ट रूप से कोई पिप पैकेज नहीं — इसे अपने रिपॉजिटरी में कॉपी करें, इसे पढ़ें, इसे चलाएं।

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

सहायक एक `framework-trace.v0.7.0` साइडकार उत्पन्न करता है जिसमें एक फोरेंसिक `helper` ब्लॉक होता है (नाम, संस्करण, स्रोत_हैश, फ्रेमवर्क संस्करण, रनटाइम, निष्कर्षण टाइमस्टैम्प)। यह ब्लॉक **कोई प्रमाण पत्र नहीं** है — नियम 14 (इंजन-रीकंप्यूट विभेदक) प्रत्येक सहायक-उत्पन्न साइडकार पर प्राधिकारी है, चाहे सहायक कुछ भी दावा करे। एक नकली/गलत/गायब `source_hash` नियम 14 को बायपास नहीं करता है। ट्रस्ट-बाउंड्री स्टेटमेंट, निषिद्ध सूची, 9-उदाहरण प्रतिकूल कैटलॉग और नो-पिप-डिस्ट्रीब्यूशन फ्लिप-सिग्नल अनुबंध के लिए [`docs/live-helpers.md`](./docs/live-helpers.md) देखें।

**समर्थित (v0.10.x)**: PyTorch SGD + Adam + AdamW + sgd_momentum (क्लासिक/नेस्टेरोव/डैम्पनिंग, `momentum_buffer` के साथ ascent→descent साइन-फ्लिप [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099) के अनुसार)। CPU-फर्स्ट। सिंगल + मल्टी-स्टेप।
**सीमा पर अस्वीकृत**: AMP/ऑटोकैस्ट, CUDA/MPS/XLA, SGD युग्मित-L2 वेट डिके, AMSGrad/NAdam/RAdam/Lion/LBFGS, मल्टी-हिडन-लेयर टोपोलॉजी। उन फ्रेमवर्क/ऑप्टिमाइज़र के लिए हाथ से लिखे गए साइडकार मानक `bp import` पथ के माध्यम से काम करना जारी रखते हैं।

## यह क्या नहीं है

- **यह कोई प्रयोग ट्रैकर नहीं है।** [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) का उपयोग करें - ये लॉग जानकारी दर्ज करते हैं; `backprop-trace` यह पुनः निर्धारित करता है कि क्या गणित आंतरिक रूप से सुसंगत है।
- **यह लर्निंग का प्रमाण या zkML नहीं है।** [PoL](https://arxiv.org/abs/2103.05633) को वास्तविक प्रशिक्षण पर नकली साबित किया गया था ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML क्रिप्टोग्राफिक प्रमाण उत्पन्न करता है। `backprop-trace` गैर-क्रिप्टोग्राफिक है, यह एक-चरणीय प्रक्रिया है, और इसका उद्देश्य मानव या CI समीक्षक को जानकारी देना है।
- **यह आपूर्ति श्रृंखला का प्रमाण नहीं है।** [Sigstore मॉडल-साइनिंग](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) पाइपलाइन की उत्पत्ति का प्रमाण देते हैं; `backprop-trace` संख्यात्मक स्थिरता का प्रमाण देता है। एक ML-BOM, `backprop-trace` रिकॉर्ड को आंतरिक स्थिरता के प्रमाण के रूप में संदर्भित कर सकता है।

## खतरे का मॉडल

दायरे में: कोई भी रिकॉर्ड जिसे अस्वीकार किया जाना चाहिए लेकिन स्वीकार किया गया है - स्कीमा बाईपास, NaN/अनंत विषाक्तता, मानक उत्सर्जन विचलन, एंटी-चक्रीयता उल्लंघन, इंजन-रीकंप्यूट असहमति आयातित साइडकार के साथ। दायरे से बाहर: प्रशिक्षण रन की विश्वसनीयता, सत्यापन प्रक्रिया पर साइड-चैनल हमले। नियति सीमित है: बाइट-समान आउटपुट केवल समान `backprop-trace` संस्करण, Node.js 22.x और समान मानक उत्सर्जन विनिर्देश के साथ ही गारंटीकृत है। पूर्ण विवरण और प्रकटीकरण समय-सीमा के लिए [SECURITY.md](./SECURITY.md) देखें।

## स्थापना

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Node 22.x पर पिन किया गया (V8 fdlibm `Math.exp` नियतात्मकता महत्वपूर्ण है - [`docs/computation-order.md`](./docs/computation-order.md) देखें)।

## कमांड-लाइन इंटरफेस (CLI)

पूर्ण संदर्भ: [`docs/cli.md`](./docs/cli.md)।

| क्रिया | उद्देश्य |
|---|---|
| `bp reconcile receipt <file>` | सभी 26 नियमों को चलाएं; पहली विफलता पर 1 पर बाहर निकलें। |
| `bp verify mazur` | बंडल माज़ुर फिक्स्चर पर पूर्ण जांच। |
| `bp verify general <file>` | सामान्यीकृत जांच (v0.2+ रिकॉर्ड: XOR, iris, softmax+CE, ऑब्जर्वर-मोड)। |
| `bp verify multi <file.jsonl>` | मल्टी-रिकॉर्ड JSONL + क्रॉस-रिकॉर्ड नियम 9/10। |
| `bp generate {mazur,xor,iris}` | नाम दिए गए इंजन को फिर से चलाएं, मानक बाइट्स उत्सर्जित करें। |
| `bp generate from-config <file>` | एक टोपोलॉजी+इनपुट JSON से इंजन को फिर से चलाएं। |
| `bp scaffold topology --topology mazur` | xor | iris | एक प्रारंभिक इनपुट कॉन्फ़िगरेशन लिखें। |
| `bp validate-input <file>` | एक टोपोलॉजी+इनपुट कॉन्फ़िगरेशन को स्कीमा-वैलिडेट करें। |
| `bp validate <file>` | एक रिकॉर्ड को स्कीमा-वैलिडेट करें (v0.1-v0.7 का स्वचालित रूप से पता लगाता है)। |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | बाहरी फ्रेमवर्क ट्रेस को आयात करें। |
| `bp examples pytorch [--print]` | बंडल PyTorch हेल्पर का पथ प्रिंट करें (या cat करें)। |

सामान्य ध्वज: `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto|never|always`, फ़ाइल तर्क `-` = stdin। बाहर निकलने के कोड: `0` पास · `1` सत्यापन विफलता · `2` उपयोग/I-O · `3` अमान्य CLI तर्क · `4` फ्रेमवर्क लागू नहीं है।

## लाइब्रेरी

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

उप-पथ आयात: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, साथ ही स्कीमा परिवार `./schema/...`।

## 16 नियम

पूर्ण विवरण + प्रतिकूल फिक्स्चर: [`docs/reconciliation.md`](./docs/reconciliation.md)।

| # | नियम |
|---|---|
| 0 | संरचनात्मक विफलता संकेतक (स्कीमा-स्तर) |
| 0.8 | संभाव्यता सीमाएं - सॉफ्टमैक्स आउटपुट [0, 1] में |
| 1-4 | त्रुटि संकेत (आउटपुट, डाउनस्ट्रीम, छिपे हुए) + अपडेट ग्रेडिएंट स्थिरता। |
| 5-7 | अपडेट मान, वजन प्रगति, अंतिम स्थिति (नियम 6/7 के लिए AdamW शाखा, जो वज़न को अलग रखता है)। |
| 8 | उत्पत्ति संदर्भ की स्थिरता |
| 9-10 | मल्टी-स्टेप पैरामीटर चेन + ट्रेस पहचान। |
| 11-13 | सॉफ्टमैक्स सामान्यीकरण + हानि सूत्र + द्विविध रूप (GATED)। |
| 14 | इंजन-रीकंप्यूट विभेदक (ऑब्जर्वर-मोड आयात पर अनिवार्य)। |
| 15-17 | स्किप-आधार + हस्ताक्षरित-डाइजेस्ट बंधन + बंडल-रूट बंधन (GATED)। |
| 18-19 | बैच रिडक्शन स्थिरता + नमूना-सेट सामंजस्य (GATED)। |
| 20 | ऑप्टिमाइज़र-स्टेट आकार (Adam `{m, v}` / sgd_momentum `{buffer}`)। |
| 21 | **PyTorch-शैली SGD मोमेंटम**: 21a बफर पुनरावृत्ति + 21b प्रभावी दिशा + 21c पैरामीटर अपडेट। |
| 22-24 | एडम मोमेंट की पुनरावृत्ति + पूर्वाग्रह सुधार + पैरामीटर अपडेट (एप्सिलॉन, वर्गमूल के बाहर) |
| 25-26 | मल्टी-स्टेप ऑप्टिमाइज़र-स्टेट चेन + ऑप्टिमाइज़र-कॉन्फ़िगरेशन की स्थिरता |

## नियति का दायरा

नोड 22.x पर आधारित, {उबंटू, मैकओएस, विंडोज} के साथ, बैकप्रोप-ट्रेस 0.10.x: बाइट-इक्वल गोल्डन्स (माज़ूर, XOR, आइरिस, सॉफ्टमैक्स+सीई, मल्टी-स्टेप, बैचड, एक्सटर्नल साइडकार); माज़ूर एंकर `post_update_loss.total = 0.29102777369359933`; इंजन द्वारा बनाए गए नियमों के लिए `atol=1e-12` और `rtol=1e-9` के साथ प्रति-नियम सामंजस्य।

अनुबंध के अंतर्गत नहीं: क्रॉस-इंजन (बुन, डेनो, ब्राउज़र); क्रॉस-नोड-मेजर (24.x+); मनमाने वी8 माइनर अपडेट। एक `Math.exp(-0.5)` कैनरी हर सीआई सेल पर वी8 एफडीलिबएम ड्रिफ्ट के खतरे के संकेत के रूप में सक्रिय होता है।

## इस संस्करण में क्या नहीं है (अभी तक)

बैकप्रोप-ट्रेस v0.11.0 npm पर प्रकाशित होने वाला पहला संस्करण है, लेकिन **अभी भी v0 का मध्य चरण** है। इंजन, रीकॉन्साइलर, कैनोनिकल-उत्सर्जन अनुबंध, बाहरी इनग्रेशन पाथ और पायटॉर्च लाइव हेल्पर वास्तविक और स्थिर हैं। v1.0 के लिए इन चीजों की आवश्यकता होगी:

- **विभिन्न मल्टी-फ्रेमवर्क ट्रेस** — केवल सिंगल-फ्रेमवर्क बंडल; मिश्रित-फ्रेमवर्क स्ट्रीम समर्थित नहीं हैं। *यह दायरे से बाहर रह सकता है।*
- **मल्टी-स्टेप ट्रेस पर प्रोड्यूसर-पहचान बाइंडिंग** — नियम 17, बंडल अखंडता विफलताओं को पकड़ता है, न कि प्रोड्यूसर की प्रामाणिकता को। नियम 16 / सिग्स्टोर / आउट-ऑफ-बैंड प्रमाणीकरण के साथ मिलाएं। यह एक अंतर्निहित सुविधा नहीं है, बल्कि एक ऑपरेटर इंटरफ़ेस है।
- **एसजीडी कपल्ड-एल2 वेट डीके** — नियम 7 का तीसरा भाग; *v0.11।*
- **एएमएसग्रेड / एनएडम / आरएडम / लायन / प्रति-पैरामीटर समूह / एलआर शेड्यूल / ग्रेडिएंट क्लिपिंग / मिश्रित परिशुद्धता** — *v0.10+।*
- **बैच किए गए रसीदों में प्रति-नमूना ग्रेडिएंट** — केवल आज तक कम किए गए ग्रेडिएंट; प्रति-नमूना अपघटन, प्रभाव ऑडिट के लिए उपयोगी है। *v0.10.x / v0.11।*
- **कदमों में विभिन्न बैच आकार** — प्रति स्ट्रीम एक निश्चित `batch_size`। *यह दायरे से बाहर रह सकता है।*
- **जेएएक्स / टेन्सरफ्लो लाइव हेल्पर** — हाथ से बनाए गए साइडकार काम करते हैं; लाइव हेल्पर *v0.11 (जेएएक्स, एडॉप्टर-पुल ट्रिगर किया गया) / v0.12+ (टीएफ)* हैं।
- **वास्तविक दुनिया का उदाहरण** — माज़ूर 2-2-2 + सॉफ्टमैक्स+सीई + sgd_momentum-माज़ूर नायक हैं; छोटे सीएनएन / ट्रांसफॉर्मर-ब्लॉक उदाहरण *v0.11* है।
- **एडॉप्टर सत्यापन** — कोई बाहरी शोधकर्ता केस स्टडी नहीं, कोई कोर्स अपनाना नहीं, कोई अनुपालन बंडल नहीं। *v1.0 से पहले v0.12।*
- **जीपीयू दृढ़ता** — दायरे से बाहर और संभवतः स्थायी (cuDNN ConvolutionBackwardFilter एटॉमिक्स बिट-सटीक होने को रोकते हैं, जैसा कि [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)) में बताया गया है। उत्पाद की स्थिति, दृढ़ता वाले सीपीयू का क्षेत्र है।

यदि आपकी कार्यप्रणाली इनमें से किसी पर भी निर्भर है, तो यह संस्करण अभी आपके लिए सही नहीं है।

## एक कस्टम टोपोलॉजी बनाएं

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

[`docs/authoring.md`](./docs/authoring.md) देखें — इनपुट बनाम रसीद स्कीमा, कैनोनिकल-उत्सर्जन ट्रस्ट बाउंड्री।

## यह कहां फिट बैठता है

- **पुनरुत्पादन-प्रथम पेपर लेखक** (न्यूरिप्स/आईसीएमएल/कोला; [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452) के बारे में जागरूक) — समीक्षक द्वारा 30 सेकंड में चलाए जा सकने वाले, प्रति-कदम प्रमाणों को फिर से प्राप्त किया जा सकता है।
- **एमएल शिक्षाशास्त्र** (करापाथी जीरो-टू-हीरो, विश्वविद्यालय डीएल पाठ्यक्रम, साक्षात्कार की तैयारी) — हर कारक के साथ एक नामित प्रशिक्षण चरण और एक ऐसा रीकॉन्साइलर जो जानबूझकर खराब किए गए उदाहरणों को *अस्वीकार* करता है।
- **एमएल फ्रेमवर्क / कंपाइलर इंजीनियर** (पायटॉर्च / जेएएक्स / एमएलआईआर / एक्सएलए योगदानकर्ता) — विभेदक परीक्षण के लिए ज्ञात-अच्छे प्रति-ऑप ट्रेस।
- **एमएल अनुपालन / ऑडिट इंजीनियर** ([यू यूरोपीय संघ एआई अधिनियम अनुच्छेद 10](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — मॉडल हस्ताक्षर से नीचे प्रति-कदम रसीद, मॉडल कार्ड या ऑडिट बंडल से जुड़ी।

## कानून का ढेर (The law stack)

`docs/canonical-emission.md` से:

> अनुबंध इंजन से पहले आता है। फ़ॉर्मेटर नीति रनटाइम फ़ॉर्मेटिंग से पहले आती है। खराब रसीदें अच्छी रसीदों से पहले आती हैं। रनटाइम फ़ॉर्मेटिंग माज़ुर से पहले आती है। माज़ुर निदान से पहले आता है।

## लिंक

- [`docs/quickstart.md`](./docs/quickstart.md) — पांच मिनट का परिचय
- [`docs/cli.md`](./docs/cli.md) — `bp` उप-कमांड संदर्भ
- [`docs/live-helpers.md`](./docs/live-helpers.md) — v0.10 लाइव PyTorch सहायक: कार्यप्रवाह, विश्वास सीमा, प्रतिकूल सूची, नो-पिप तर्क
- [`docs/authoring.md`](./docs/authoring.md) — कस्टम टोपोलॉजी का निर्माण
- [`docs/reconciliation.md`](./docs/reconciliation.md) — 26 पुनर्संयोजन नियम, पूरी तरह से
- [`docs/topology.md`](./docs/topology.md) — सामान्य टोपोलॉजी का निर्माण
- [`docs/multi-step.md`](./docs/multi-step.md) — बहु-चरणीय प्रशिक्षण विवरण
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — बाइट-स्तरीय एन्कोडिंग अनुबंध
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 क्रम; FMA निषेध; नियतिवाद सीमा
- [`docs/schema.md`](./docs/schema.md) — फ़ील्ड-दर-फ़ील्ड स्कीमा का विवरण
- [`docs/attestation.md`](./docs/attestation.md) — इन-टोटो v1 प्रमाणन
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — एंटी-सर्कुलैरिटी तंत्र; खराब-प्राप्ति-पहले-अच्छी सिद्धांत
- [`SECURITY.md`](./SECURITY.md) — सत्यापनकर्ता के लिए क्या भेद्यता मानी जाती है
- [`CHANGELOG.md`](./CHANGELOG.md) — संस्करण-दर-संस्करण इतिहास

## लाइसेंस

एमआईटी — देखें [लाइसेंस](./LICENSE)।

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
