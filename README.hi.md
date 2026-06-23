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

एक तंत्रिका नेटवर्क प्रशिक्षण चरणों के लिए एक नियतात्मक 26-नियम सत्यापनकर्ता। आप इसे एक रसीद प्रदान करते हैं जिसमें उन सभी कारकों का उल्लेख होता है जिन्होंने किसी एक ग्रेडिएंट अपडेट में योगदान दिया; पुनर्समायोजक प्रत्येक दावे को फिर से प्राप्त करता है और असहमति होने पर उसे अस्वीकार कर देता है। *"ओरेकल को उस कलाकृति से परामर्श नहीं करना चाहिए जिसका वह मूल्यांकन करता है।"* की सीस्मिथ/कंपसर्ट श्रृंखला में।

> **v1.0.0 — केवल CPU, नियतात्मक।** सत्यापनकर्ता SGD · Adam · AdamW · SGD-मोमेंटम (शास्त्रीय / नेस्टेरोव / डैम्पिंग) · **SGD युग्मित-L2 भार क्षय**, 26 पुनर्समायोजक नियमों में शामिल है। लाइव **PyTorch और JAX** सहायक उपकरण एक वास्तविक प्रशिक्षण चरण को एक सत्यापन योग्य रसीद में परिवर्तित करते हैं — केवल पर्यवेक्षक, [नियम 14](./docs/reconciliation.md) प्रत्येक आयातित साइडकार पर अधिकार रखता है। 940 नियतात्मक परीक्षण; सत्यापनकर्ता-स्वामित्व वाली सहिष्णुता सीमाएं; एंटी-सर्कुलरिटी रैचेट। उत्पादन उपयोग से पहले [`docs/live-helpers.md`](./docs/live-helpers.md) देखें और संस्करण इतिहास के लिए [CHANGELOG](./CHANGELOG.md)।

## 30 सेकंड का त्वरित आरंभ

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

माज़ुर 2-2-2 खुली वेब पर सबसे अधिक उद्धृत एकल-चरण बैकप्रोप वॉक्थ्रू है ([मैट माज़ुर, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/))। इसमें प्रत्येक संख्या को हाथ से प्राप्त किया जा सकता है।

## यह क्या है

एक प्रशिक्षण चरण के लिए एक संख्यात्मक-शुद्धता सत्यापनकर्ता। पुनर्समायोजक 26 नियमों का पालन करता है जो नामित कारकों से प्रत्येक दावे को फिर से प्राप्त करते हैं। यदि कोई भी नियम हाइब्रिड सहिष्णुता (`atol + rtol`) के भीतर असहमत होता है, तो रसीद अस्वीकार कर दी जाती है। बहु-चरणीय (नियम 9 + 10), बैच (नियम 18 + 19), एडम मोमेंट पुनरावृत्तियाँ (नियम 22-24), SGD मोमेंटम पुनरावृत्ति (नियम 20 + 21a/21b/21c + 25 + 26), और आयातित ढांचे के निशान पर इंजन-पुनर्गणना अंतर (नियम 14) उत्पादन-प्रासंगिक सतहों को कवर करते हैं।

यह **समग्र प्रशिक्षण रन को मान्य नहीं करता है**, यह साबित नहीं करता है कि मॉडल सही है, या यह किसी प्रयोग ट्रैकर की जगह नहीं लेता है। यह साबित करता है कि प्रत्येक रिकॉर्ड किए गए चरण गणितीय रूप से सुसंगत है और श्रृंखला अक्षुण्ण है। प्रतिकूल कॉर्पोरा एक सत्यापनकर्ता को सिद्ध करते हैं ([सीस्मिथ पीएलडीआई 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [कंपसर्ट सीएसीएम 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — प्रत्येक नियम [`fixtures/bad/`](./fixtures/bad) के तहत एक युग्मित खराब फिक्स्चर के साथ आता है जिसे सत्यापनकर्ता को किसी भी `fixture_status` मेटाडेटा को पढ़ने से *पहले* अस्वीकार करना चाहिए।

## लाइव PyTorch सहायक (v0.10+)

एकल ऑडिट योग्य पायथन फ़ाइल। डिज़ाइन द्वारा कोई पिप पैकेज नहीं — इसे अपनी रिपो में कॉपी करें, पढ़ें, चलाएं।

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

सहायक एक `framework-trace.v0.7.0` साइडकार उत्सर्जित करता है जिसमें एक फोरेंसिक `helper` ब्लॉक होता है (नाम, संस्करण, स्रोत_हैश, ढांचा संस्करण, रनटाइम, निष्कर्षण टाइमस्टैम्प)। यह ब्लॉक **कोई क्रेडेंशियल नहीं है** — नियम 14 (इंजन-पुनर्गणना अंतर) प्रत्येक सहायक द्वारा उत्सर्जित साइडकार पर अधिकार रखता है, चाहे सहायक कुछ भी दावा करे। एक स्पूफ/गलत/गायब `source_hash` नियम 14 को बायपास नहीं करता है। विश्वास-सीमा कथन, निषिद्ध सूची, 9-फिक्स्चर प्रतिकूल कैटलॉग और नो-पिप-वितरण फ्लिप-सिग्नल अनुबंध के लिए [`docs/live-helpers.md`](./docs/live-helpers.md) देखें।

**समर्थित**: PyTorch SGD + Adam + AdamW + sgd_momentum (शास्त्रीय/नेस्टेरोव/डैम्पिंग) + **SGD युग्मित-L2 भार क्षय**, जिसमें [`PyTorch issue #1099`](https://github.com/pytorch/pytorch/issues/1099) के अनुसार `momentum_buffer` असेंट→अवरोहण चिह्न-फ्लिप है। CPU-प्रथम। एकल + बहु-चरणीय। एक समानांतर **लाइव JAX सहायक** (`scripts/extract/jax.py`) SGD + Adam को एक मजबूत विश्वास सीमा के साथ कवर करता है — यह एक `jax.make_jaxpr(jax.grad(loss))` डाइजेस्ट को फोरेंसिक ब्लॉक में जोड़ता है (निरीक्षण योग्य ग्रेडिएंट ग्राफ जो PyTorch ईगर में नहीं होता है), और `jax_enable_x64` + CPU के बिना चलने से इनकार करता है। [`docs/live-helpers.md`](./docs/live-helpers.md) देखें।
**सीमा पर अस्वीकृत**: AMP/ऑटोकास्ट, CUDA/MPS/XLA, AMSGrad/NAdam/RAdam/Lion/LBFGS, बहु-छिपी परत टोपोलॉजी। उन ढांचों/अनुकूलकों के लिए हाथ से लिखे गए साइडकार मानक `bp आयात` पथ के माध्यम से काम करना जारी रखते हैं।

## यह क्या नहीं है

- **कोई प्रयोग ट्रैकर नहीं।** [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) का उपयोग करें — वे दावों को लॉग करते हैं; बैकप्रोप-ट्रेस यह फिर से प्राप्त करता है कि क्या गणित आंतरिक रूप से सुसंगत है।
- **प्रूफ-ऑफ-लर्निंग या zkML नहीं।** [PoL](https://arxiv.org/abs/2103.05633) को वास्तविक प्रशिक्षण पर जाली दिखाया गया था ([फांग एट अल। यूरोएसएंडपी 2023](https://arxiv.org/abs/2208.03567)); zkML क्रिप्टोग्राफ़िक प्रमाण उत्पन्न करता है। बैकप्रोप-ट्रेस गैर-क्रिप्टोग्राफ़िक, एकल-चरणीय है, दर्शक एक मानव या सीआई-समीक्षक है।
- **कोई आपूर्ति-श्रृंखला सत्यापन नहीं।** [सिगस्टोर मॉडल-हस्ताक्षर](https://github.com/sigstore/model-transparency), [एसएलएसए-फॉर-मॉडल](https://slsa.dev), [साइक्लोनडीएक्स एमएल-बीओएम](https://cyclonedx.org/capabilities/mlbom/) पाइपलाइन उत्पत्ति को प्रमाणित करते हैं; बैकप्रोप-ट्रेस संख्यात्मक स्थिरता को प्रमाणित करता है। एक एमएल-बीओएम आंतरिक-संगति विधेय के रूप में बैकप्रोप-ट्रेस रसीद का संदर्भ दे सकता है।

## खतरा मॉडल

दायरे में: कोई भी रसीद जिसे अस्वीकार किया जाना चाहिए लेकिन स्वीकार कर लिया जाता है — स्कीमा बाईपास, NaN/अनंत विषाक्तता, विहित-उत्सर्जन विचलन, एंटी-सर्कुलरिटी उल्लंघन, आयातित साइडकारों पर इंजन-पुनर्गणना असहमति। दायरे से बाहर: प्रशिक्षण रन की स्वयं विश्वसनीयता, सत्यापनकर्ता प्रक्रिया पर साइड-चैनल हमले। नियतत्व सीमित है: बाइट-समान आउटपुट केवल समान बैकप्रोप-ट्रेस संस्करण, नोड.जेएस 22.x और समान विहित-उत्सर्जन विशिष्टता में गारंटीकृत है। पूर्ण गणना + प्रकटीकरण समयरेखा के लिए [SECURITY.md](./SECURITY.md) देखें।

## स्थापित करें

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

नोड 22.x पर पिन किया गया (V8 fdlibm `Math.exp` नियतत्व भार वहन करता है — [`docs/computation-order.md`](./docs/computation-order.md) देखें)।

## सीएलआई

पूर्ण संदर्भ: [`docs/cli.md`](./docs/cli.md)।

| क्रिया | उद्देश्य |
|---|---|
| `bp reconcile receipt <file>` | सभी 26 नियमों को चलाएं; पहली विफलता पर 1 से बाहर निकलें |
| `bp verify mazur` | बंडल किए गए माज़ुर फिक्स्चर पर पूर्ण गेट |
| `bp verify general <file>` | सामान्यीकृत गेट (v0.2+ रसीदें: XOR, आइरिस, सॉफ्टमैक्स+CE, पर्यवेक्षक-मोड) |
| `bp verify multi <file.jsonl>` | बहु-रिकॉर्ड JSONL + क्रॉस-रिकॉर्ड नियम 9/10 |
| `bp generate {mazur,xor,iris}` | निर्दिष्ट इंजन को फिर से चलाएं, मानक बाइट्स उत्सर्जित करें |
| `bp generate from-config <file>` | एक टोपोलॉजी+इनपुट JSON से इंजन को फिर से चलाएं |
| `bp स्कैफोल्ड टोपोलॉजी --टॉपोलॉजी मज़ूर\ | xor\ | आइरिस` | एक प्रारंभिक इनपुट कॉन्फ़िगरेशन लिखें |
| `bp validate-input <file>` | एक टोपोलॉजी+इनपुट कॉन्फ़िगरेशन को स्कीमा-मान्य करें |
| `bp validate <file>` | एक रसीद को स्कीमा-मान्य करें (स्वचालित रूप से v0.1-v0.7 का पता लगाता है) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | बाहरी ढांचे के ट्रेस को शामिल करें |
| `bp examples {pytorch,jax} [--print]` | बंडल किए गए लाइव PyTorch / JAX सहायक का पथ प्रिंट करें (या cat करें) |

सामान्य ध्वज: `--out <फ़ाइल>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, फ़ाइल तर्क `-` = stdin. निकास कोड: `0` पास · `1` सत्यापन विफलता · `2` उपयोग/I-O · `3` अमान्य CLI तर्क · `4` ढांचा लागू नहीं किया गया।

## पुस्तकालय

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

> **कौन सा गेट क्या साबित करता है।** `reconcileReceipt` यह साबित करता है कि रसीद का गणित
> *आंतरिक रूप से सुसंगत* है (26 नियम प्रत्येक दावे को रसीद के अपने कारकों से फिर से प्राप्त करते हैं)। **अज्ञात उत्पत्ति** की एक रसीद के लिए, इसे इंजन-रीप्रोड्यूस गेट के साथ जोड़ें - `verifyEngineReproduces` (या `bp verify general`), जो रसीद के इनपुट से नियतात्मक इंजन को फिर से चलाता है और फ़ील्ड-दर-फ़ील्ड तुलना करता है। वह दूसरा गेट है जो एंटी-चक्रीयता आवरण को बंद करता है: केवल आंतरिक सुसंगतता ही एक विदेशी रसीद का पता नहीं लगा सकती है जिसे इंजन द्वारा बनाया गया बताया गया है, क्योंकि कोई भी प्रति-रसीद नियम इंजन द्वारा बनाई गई रसीद के लिए आगे की प्रक्रिया को फिर से प्राप्त नहीं करता है। पर्यवेक्षक-मोड आयात (`importPytorchSidecar`) स्वचालित रूप से इंजन-रीप्रोड्यूस अंतर (नियम 14) चलाते हैं; `bp verify` हमेशा दोनों गेट चलाता है।

उपपथ आयात: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, साथ ही स्कीमा परिवार `./schema/...`।

## 26 नियम

पूर्ण कथन + प्रतिकूल फिक्स्चर: [`docs/reconciliation.md`](./docs/reconciliation.md)।

| # | नियम |
|---|---|
| 0 | संरचनात्मक-विफलता प्रहरी (स्कीमा-स्तर) |
| 0.8 | संभाव्यता सीमाएँ - सॉफ्टमैक्स आउटपुट [0, 1] में |
| 1-4 | त्रुटि संकेत (आउटपुट, डाउनस्ट्रीम, छिपे हुए) + अपडेट ग्रेडिएंट सुसंगतता |
| 5-7 | अपडेट मान, भार प्रगति, अंतिम स्थिति (नियम 6/7 पर AdamW शाखा अलग किए गए wd के लिए) |
| 8 | उत्पत्ति संदर्भ सुसंगतता |
| 9-10 | बहु-चरणीय पैरामीटर श्रृंखला + ट्रेस पहचान |
| 11-13 | सॉफ्टमैक्स सामान्यीकरण + हानि सूत्र + द्वैध रूप (गेटेड) |
| 14 | इंजन-रीकंप्यूट अंतर (पर्यवेक्षक-मोड आयात पर अनिवार्य) |
| 15-17 | स्किप-आधार + हस्ताक्षरित-सारांश बंधन + बंडल-रूट बंधन (गेटेड) |
| 18-19 | बैच कमी सुसंगतता + नमूना-सेट सामंजस्य (गेटेड) |
| 20 | ऑप्टिमाइज़र-स्टेट आकार (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **PyTorch-शैली SGD संवेग**: 21a बफर पुनरावृत्ति + 21b प्रभावी दिशा + 21c पैरामीटर अपडेट |
| 22-24 | एडम मोमेंट पुनरावृत्तियाँ + पूर्वाग्रह सुधार + पैरामीटर अपडेट (एप्सिलॉन एसक्यूआरटी के बाहर) |
| 25-26 | बहु-चरणीय ऑप्टिमाइज़र-स्टेट श्रृंखला + ऑप्टिमाइज़र-कॉन्फ़िगरेशन स्थिरता |

## नियतिवाद का दायरा

नोड 22.x × {उबंटू, मैकओएस, विंडोज} × बैकप्रोप-ट्रेस 0.12.x पर संविदात्मक: बाइट-समान गोल्डन (मज़ूर, XOR, आइरिस, सॉफ्टमैक्स+CE, बहु-चरणीय, बैच, बाहरी साइडकार); मज़ूर एंकर `post_update_loss.total = 0.29102777369359933`; इंजन द्वारा बनाए गए के लिए `atol=1e-12`, `rtol=1e-9` पर प्रति-नियम सामंजस्य।

संविदात्मक नहीं: क्रॉस-इंजन (बुन, डेनो, ब्राउज़र); क्रॉस-नोड-प्रमुख (24.x+); मनमाना V8 मामूली वृद्धि। प्रत्येक CI सेल पर `Math.exp(-0.5)` कैनरी एक V8 fdlibm बहाव सायरन के रूप में फायर करता है।

## इस संस्करण में क्या नहीं है (अभी तक)

v1.0.0 नियतात्मक-CPU कोने को अंत से अंत तक कवर करता है: इंजन, रिकॉन्सिलर, मानक-उत्सर्जन अनुबंध, बाहरी समावेशन पथ, लाइव PyTorch **और** JAX सहायक, SGD-परिवार ऑप्टिमाइज़र जिसमें युग्मित-L2 भार क्षय शामिल है, एक पहचानने योग्य नायक फिक्स्चर और एक काम किया हुआ [अनुपालन बंडल](./docs/compliance.md)। नीचे दिया गया रोडमैप वह है जो **जानबूझकर अभी तक कवर नहीं किया गया है** - उपयोग × सत्यापन-व्यवहार्यता के अनुसार क्रमबद्ध, प्रत्येक एक बंद-रूप CPU रीकंप्यूट पर गेटेड जिसे रिकॉन्सिलर वास्तव में स्वामित्व कर सकता है:

- **एनएडम (+ वैकल्पिक रूप से आरएडम)** - एडम के सस्ते संस्करण। फिर **एलआर-शेड्यूल सत्यापन**, जो हर ऑप्टिमाइज़र के साथ जुड़ता है। *अगला।*
- **एएमएसग्रैड / ग्लोबल-नॉर्म ग्रेडिएंट क्लिपिंग / प्रति-समूह एलआर / लायन** - प्रत्येक को एक रसीद/सुलह एक्सटेंशन पर आधारित किया गया है। *बाद में।*
- **कन्व / मल्टी-हिडन-लेयर टोपोलॉजी** - इंजन सिंगल-हिडन-लेयर डेंस है; मुख्य विशेषता एक पहचानने योग्य डेंस ReLU→सॉफ्टमैक्स क्लासिफायर है। कन्व फ्यूज्ड-कर्नेल एफपी-ऑर्डरिंग लाता है जो बिट-निर्धारण से लड़ता है (नीचे जीपीयू देखें)। *संभवतः सीपीयू-निर्धारित दायरे से बाहर।*
- **विषम बहु-ढांचा ट्रेस** - केवल सिंगल-ढांचा बंडल; मिश्रित-ढांचा स्ट्रीम समर्थित नहीं हैं। *शायद दायरे से बाहर रहेगा।*
- **चरणों में विषम बैच आकार** - प्रति स्ट्रीम निश्चित बैच_साइज़। *शायद दायरे से बाहर रहेगा।*
- **बैच किए गए रसीदों में प्रति-नमूना ग्रेडिएंट** - केवल आज कम किए गए ग्रेडिएंट; प्रति-नमूना अपघटन प्रभाव ऑडिट के लिए उपयोगी है लेकिन अभी तक उजागर नहीं किया गया है। *बाद में।*
- **बहु-चरणीय ट्रेस पर निर्माता-पहचान बाध्यकारी** - नियम 17 बंडल-अखंडता विफलताओं को पकड़ता है, न कि निर्माता की प्रामाणिकता को। नियम 16 / सिगस्टोर / आउट-ऑफ-बैंड सत्यापन के साथ मिलाएं। ऑपरेटर सतह, अंतर्निहित नहीं।
- **जीपीयू / फ्यूज्ड-कर्नेल बिट-निर्धारण** - दायरे से बाहर और स्थायी। फ्लोटिंग-पॉइंट गैर-एसोसिएटिविटी फ्यूज्ड/समानांतर कर्नेल में बिट-सटीकता को अप्राप्य बना देती है ([arXiv:2408.05148](https://arxiv.org/abs/2408.05148); cuDNN ConvolutionBackwardFilter एटॉमिक्स प्रति [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/))। उत्पाद एक निर्धारित सीपीयू कोना है।

यदि आपका वर्कफ़्लो इनमें से किसी पर निर्भर करता है, तो यह अभी आपके लिए सही संस्करण नहीं है।

## एक कस्टम टोपोलॉजी लिखें

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

[`docs/authoring.md`](./docs/authoring.md) देखें - इनपुट बनाम रसीद स्कीमा, कैनोनिकल-उत्सर्जन ट्रस्ट सीमा।

## यह कहाँ फिट बैठता है

- **पुनरुत्पादनीयता-प्रथम पेपर लेखक** (न्यूरआईपीएस/आईसीएमएल/कोलाएस; [आरईएफओआरएमएस](https://www.science.org/doi/10.1126/sciadv.adk3452)-जागरूक) - प्रति-चरण साक्ष्य जिसे समीक्षक 30 सेकंड में चला सकता है।
- **एमएल शिक्षाशास्त्र** (कारपाथी ज़ीरो-टू-हीरो, विश्वविद्यालय डीएल पाठ्यक्रम, साक्षात्कार की तैयारी) - प्रत्येक कारक के साथ एक एकल नामित प्रशिक्षण चरण दिखाई देता है और एक सुलहकर्ता जो जानबूझकर टूटे हुए तत्वों को *अस्वीकार* करता है।
- **एमएल ढांचा / कंपाइलर इंजीनियर** (पायटॉर्च / जेएएक्स / एमएलआईआर / एक्सएलए योगदानकर्ता) - अंतर परीक्षण के लिए ज्ञात-अच्छा प्रति-ऑप ट्रेस।
- **एमएल अनुपालन / ऑडिट इंजीनियर** ([ईयू एआई अधिनियम अनुलग्नक IV §2(g) सत्यापन/परीक्षण लॉग + अनुच्छेद 15 मजबूती](https://artificialintelligenceact.eu/annex/4/); SLSA-फॉर-ML) - मॉडल-हस्तांकन के नीचे एक सत्यापित, दिनांकित, हस्ताक्षरित परीक्षण-लॉग रिकॉर्ड के रूप में प्रति-चरण रसीद। काम करने वाला [अनुपालन बंडल](./docs/compliance.md) देखें (और ईमानदार दायरा: रसीदें *गणित* की पुष्टि करती हैं, न कि डेटा शासन)।

## कानून का ढांचा

`docs/canonical-emission.md` से:

> अनुबंध इंजन से पहले आता है। फ़ॉर्मेटर नीति रनटाइम स्वरूपण से पहले आती है। खराब रसीदें अच्छी रसीदों से पहले आती हैं। रनटाइम स्वरूपण माज़ुर से पहले आता है। माज़ुर निदान से पहले आता है।

## लिंक्स

- [`docs/quickstart.md`](./docs/quickstart.md) - पांच मिनट का त्वरित प्रदर्शन
- [`docs/cli.md`](./docs/cli.md) - `bp` सबकमांड संदर्भ
- [`docs/live-helpers.md`](./docs/live-helpers.md) - v0.10 लाइव पायटॉर्च हेल्पर: वर्कफ़्लो, ट्रस्ट सीमा, प्रतिकूल सूची, नो-पीआईपी तर्क
- [`docs/authoring.md`](./docs/authoring.md) - एक कस्टम टोपोलॉजी लिखें
- [`docs/reconciliation.md`](./docs/reconciliation.md) - 26 सुलह नियम पूरी तरह से
- [`docs/topology.md`](./docs/topology.md) - सामान्य-टोपोलॉजी लेखन
- [`docs/multi-step.md`](./docs/multi-step.md) - बहु-चरणीय प्रशिक्षण रसीदें
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) - बाइट-स्तरीय एन्कोडिंग अनुबंध
- [`docs/computation-order.md`](./docs/computation-order.md) - आईईईई 754 ऑर्डरिंग; एफएमए निषेध; निर्धारण सीमा
- [`docs/schema.md`](./docs/schema.md) - फ़ील्ड-दर-फ़ील्ड स्कीमा प्रदर्शन
- [`docs/attestation.md`](./docs/attestation.md) - इन-टोटो v1 सत्यापन सीम
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - एंटी-सर्कुलरिटी रैचेट; खराब-रसीदें-पहले-अच्छी सिद्धांत
- [`SECURITY.md`](./SECURITY.md) - एक सत्यापनकर्ता के लिए क्या असुरक्षा गिना जाता है
- [`CHANGELOG.md`](./CHANGELOG.md) - संस्करण-दर-संस्करण इतिहास

## लाइसेंस

एमआईटी - [LICENSE](./LICENSE) देखें।

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
