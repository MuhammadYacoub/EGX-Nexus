# 🇪🇬 EGX-Nexus (Egyptian Exchange Nexus)

<p align="center">
  <b>A fully autonomous AI-powered trading intelligence platform specifically for the Egyptian Stock Exchange (EGX).</b><br>
  <i>منصة ذكاء تداول مستقلة ومدعومة بالذكاء الاصطناعي مخصصة للبورصة المصرية.</i>
</p>

---

## 📖 Table of Contents | جدول المحتويات
- [English Documentation](#-english-documentation)
  - [Vision & Purpose](#vision--purpose)
  - [Key Features](#key-features)
  - [Architecture & Microservices](#architecture--microservices)
  - [The Multi-Agent Debate System](#the-multi-agent-debate-system)
  - [Prerequisites & Setup](#prerequisites--setup)
  - [Roadmap](#roadmap)
- [التوثيق باللغة العربية](#-التوثيق-باللغة-العربية)
  - [الرؤية والهدف](#الرؤية-والهدف)
  - [المميزات الرئيسية](#المميزات-الرئيسية)
  - [البنية التحتية والخدمات المصغرة](#البنية-التحتية-والخدمات-المصغرة)
  - [نظام نقاش وكلاء الذكاء الاصطناعي](#نظام-نقاش-وكلاء-الذكاء-الاصطناعي)
  - [المتطلبات والتشغيل](#المتطلبات-والتشغيل)
  - [خارطة الطريق](#خارطة-الطريق)

---

# 🇬🇧 English Documentation

## Vision & Purpose
**EGX-Nexus** is an independent, ground-up intelligence system designed to democratize financial intelligence for Egyptian retail traders. By operating entirely locally and natively understanding the Egyptian Stock Exchange (EGX), the platform ensures data privacy, independence from paid external APIs, and zero reliance on generic LLMs for financial calculations.

The system combines real-time broker WebSocket streams, historical OHLCV analysis, and a unique **Multi-Agent AI Debate System** to produce actionable BUY/SELL/HOLD decisions.

To achieve the highest decision accuracy, EGX-Nexus embraces a **Hybrid AI Approach**, seamlessly integrating traditional Machine Learning (ML) classifiers with advanced Deep Learning (DL) models. This hybrid system extracts sophisticated insights from complex, high-dimensional financial data to dynamically anticipate shifting market patterns in real-time.

## Deep Learning Integration
EGX-Nexus leverages state-of-the-art Deep Learning frameworks (like TensorFlow and PyTorch) to process massive datasets that traditional ML struggles with.
- **Sequential Pattern Recognition:** LSTMs and Transformers analyze historical price and volume sequences to detect hidden market regimes.
- **Dynamic Adaptation:** DL models dynamically re-adjust to changing market conditions and volatility clusters on the EGX.
- **Hybrid Synergy:** The `deep-learning-engine` feeds complex feature embeddings and non-linear probabilities directly into the `core-brain` debate manager, allowing traditional ML agents and DL engines to collaborate on the final trading signal.

## Key Features
- **Local-First & Autonomous**: No paid external LLMs (e.g., OpenAI, Anthropic). The system relies on its own natively trained ML models for price prediction and local models (via Ollama) exclusively for Arabic NLP and news sentiment.
- **Real-Time Price Streaming**: Deep integration with direct broker WebSockets for immediate market reaction.
- **Historical Data Harvesting**: Automated OHLCV data collection from Yahoo Finance, securely stored in MySQL.
- **Advanced Technical Analysis**: A deterministic rule engine running the Wyckoff Method, Elliott Waves, RSI, MACD, and Volume Profile.
- **Multi-Agent AI Debate System**: A revolutionary approach where a Bull Agent, Bear Agent, and Technical Agent debate market conditions. A Risk Manager evaluates the debate to output a final decision.
- **Telegram Notifications**: Real-time signals, alerts, and system health updates delivered straight to your Telegram.
- **Production-Ready Docker Architecture**: A clean, scalable microservices approach with automatic routing handling port conflicts cleanly.

## Architecture & Microservices
All services run in isolated Docker containers orchestrated by `docker-compose.yml`.

| Service | Port | Responsibility | Tech Stack |
|---------|------|----------------|------------|
| `core-brain` | 3000 | Orchestrator + Multi-Agent Debate Manager | Node.js |
| `auth-gateway` | 3001 | Session management + Broker Auth | Node.js |
| `analysis-engine` | 3002 | Technical indicators: Wyckoff, Elliott, RSI, MACD | Node.js |
| `prediction-engine` | 3003 | Real-time WebSocket listener + signal publisher | Node.js/TypeScript |
| `data-harvester` | 3005 | Yahoo Finance OHLCV collector, cron daily at 7 PM Cairo time | Node.js |
| `notification-hub` | 3006 | Telegram alerts for signals and decisions | Node.js |
| `dashboard-api` | 3007 | REST API for UI and dashboard | Node.js |
| `deep-learning-engine`| 3008 | GPU-accelerated DL model serving (TensorFlow/PyTorch) | Python/FastAPI |
| `training-pipeline` | N/A | Python ML model training strictly on EGX historical data | Python |
| `ollama` | 11434 | Local LLM inference (Planned for Phase 6 - Arabic NLP ONLY) | Ollama |

*Note: EGX-Nexus runs behind an internal Nginx proxy on port `8080` (not `80`) to avoid conflicts with shared server environments using Nginx Proxy Manager (NPM).*

## The Multi-Agent Debate System
The true intelligence of EGX-Nexus lies in its decentralized AI architecture within the `core-brain`.
- **Bull & Bear Agents**: Utilize specialized, natively trained ML models to identify accumulation/distribution phases and demand/supply zones.
- **Technical Agent**: Relies strictly on a deterministic rule engine (Wyckoff/Elliott).
- **Sentiment Agent**: The *only* agent utilizing the local Ollama LLM (`llama3`), restricted to analyzing Arabic news and EGX announcements.
- **Debate & Risk Managers**: Uses weighted voting (70% specialized ML, 30% sentiment) and applies strict position sizing and drawdown limits before executing a trade.

## Prerequisites & Setup
This project is intended for developers and technical traders looking to self-host the system.

### Prerequisites
1. **Docker & Docker Compose**: Ensure both are installed on your machine.
2. **Broker Credentials**: Required for live WebSocket authentication (`BROKER_USERNAME` / `BROKER_PASSWORD`).
3. **Telegram Bot**: You will need a Telegram Bot Token and your Chat ID to receive alerts.
4. **Local LLM**: Ollama must be installed and running locally with the `llama3` model pulled (Required for Phase 6).
5. **Nginx Proxy Manager (NPM)**: Awareness of shared server port configurations.

### Installation Steps
1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/egx-nexus.git
   cd egx-nexus
   ```
2. **Configure Environment Variables:**
   Copy the example environment file and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
3. **Run the Infrastructure:**
   Start all microservices in detached mode:
   ```bash
   docker-compose up -d
   ```

## Roadmap
- [x] **Phase 1** — Microservices scaffold
- [x] **Phase 2** — `prediction-engine` + `data-harvester`
- [x] **Phase 3** — Full docker-compose with healthchecks
- [ ] **Phase 4** — Nginx routing + port conflict resolution (Port 8080)
- [ ] **Phase 5** — `analysis-engine`: Wyckoff + Elliott logic
- [ ] **Phase 6** — Ollama + Multi-Agent Debate System
- [ ] **Phase 7** — `training-pipeline`: Specialized ML model training on EGX data
- [ ] **Phase 8** — Dashboard UI

---

# 🇪🇬 التوثيق باللغة العربية

## الرؤية والهدف
**EGX-Nexus** هو نظام ذكاء تداول مستقل تماماً، تم تصميمه بهدف جعل التحليل المالي الذكي في متناول المتداولين الأفراد في البورصة المصرية (EGX). من خلال العمل بشكل محلي (Local-First) والفهم العميق للبورصة المصرية، يضمن النظام خصوصية البيانات، الاستقلال التام عن واجهات برمجة التطبيقات (APIs) المدفوعة، وعدم الاعتماد على النماذج اللغوية (LLMs) العامة في الحسابات المالية.

يجمع النظام بين بث أسعار الوسيط المالي اللحظي، وتحليل البيانات التاريخية (OHLCV)، ونظام فريد **للنقاش بين وكلاء الذكاء الاصطناعي (Multi-Agent AI Debate System)** لإنتاج قرارات تداول حاسمة.

لتحقيق أقصى درجات الدقة، يتبنى EGX-Nexus **نهجاً هجيناً (Hybrid AI Approach)** يدمج بسلاسة بين مصنفات التعلم الآلي التقليدي (ML) ونماذج التعلم العميق (Deep Learning) المتطورة. يعمل هذا النظام الهجين على استخلاص رؤى مالية معقدة من البيانات الضخمة عالية الأبعاد، مما يتيح له التنبؤ الديناميكي بأنماط السوق المتغيرة لحظة بلحظة.

## تكامل التعلم العميق (Deep Learning Integration)
يستفيد EGX-Nexus من أطر التعلم العميق الرائدة (مثل TensorFlow و PyTorch) لمعالجة مجموعات البيانات الضخمة التي يصعب على تقنيات ML التقليدية التعامل معها:
- **التعرف على الأنماط المتسلسلة:** تستخدم نماذج LSTMs و Transformers لتحليل التسلسلات التاريخية للأسعار والأحجام للكشف عن أنظمة السوق الخفية.
- **التكيف الديناميكي:** تتكيف نماذج DL ديناميكياً مع ظروف السوق المتغيرة وتكتلات التقلبات في البورصة المصرية.
- **التعاون الهجين:** يوفر محرك التعلم العميق (`deep-learning-engine`) احتمالات غير خطية معقدة مباشرة إلى نظام النقاش في `core-brain`، مما يتيح لوكلاء ML التقليديين ومحركات DL التعاون لإنتاج إشارة التداول النهائية بأعلى موثوقية.

## المميزات الرئيسية
- **محلي ومستقل**: لا يعتمد على واجهات ذكاء اصطناعي خارجية مدفوعة (مثل OpenAI أو Anthropic). يعتمد النظام على نماذج تعلم الآلة (ML) المتخصصة الخاصة به لتوقع الأسعار، ويستخدم نماذج محلية (عبر Ollama) حصرياً لمعالجة اللغات الطبيعية (NLP) للأخبار باللغة العربية.
- **بث الأسعار اللحظي**: تكامل عميق مع WebSockets الخاصة بالوسطاء الماليين للتفاعل الفوري مع حركة السوق.
- **جمع البيانات التاريخية**: جمع آلي لبيانات OHLCV من Yahoo Finance وتخزينها بأمان في قاعدة بيانات MySQL.
- **تحليل فني متقدم**: محرك قواعد حتمي يدير طريقة وايكوف (Wyckoff)، وموجات إليوت (Elliott Waves)، ومؤشرات RSI و MACD، وتحليل حجم التداول (Volume Profile).
- **نظام نقاش وكلاء الذكاء الاصطناعي**: نهج ثوري حيث يتناقش وكيل الثيران (Bull Agent)، ووكيل الدببة (Bear Agent)، والوكيل الفني حول ظروف السوق. يقوم مدير المخاطر بتقييم النقاش وإصدار القرار النهائي.
- **إشعارات تيليجرام**: إشارات لحظية وتنبيهات تُرسل مباشرة إلى حسابك.
- **بنية تحتية جاهزة للإنتاج (Docker)**: بنية خدمات مصغرة (Microservices) قابلة للتطوير تحل تعارض المنافذ (Ports) بشكل آلي وتلقائي.

## البنية التحتية والخدمات المصغرة
تعمل جميع الخدمات في حاويات (Containers) معزولة عبر `docker-compose.yml`.

| الخدمة (Service) | المنفذ (Port) | المسؤولية (Responsibility) | التقنية (Tech Stack) |
|------------------|---------------|----------------------------|----------------------|
| `core-brain` | 3000 | المنسق الأساسي + مدير نقاش وكلاء الذكاء الاصطناعي | Node.js |
| `auth-gateway` | 3001 | إدارة الجلسات + المصادقة مع الوسيط | Node.js |
| `analysis-engine` | 3002 | المؤشرات الفنية: وايكوف، إليوت، RSI، MACD | Node.js |
| `prediction-engine` | 3003 | مستمع WebSocket اللحظي + ناشر الإشارات | Node.js/TypeScript |
| `data-harvester` | 3005 | جامع بيانات Yahoo Finance OHLCV، يعمل يومياً الساعة 7 مساءً بتوقيت القاهرة | Node.js |
| `notification-hub` | 3006 | ناشر تنبيهات تيليجرام لإشارات التداول | Node.js |
| `dashboard-api` | 3007 | واجهة برمجة تطبيقات (REST API) للوحة التحكم | Node.js |
| `deep-learning-engine`| 3008 | تشغيل نماذج التعلم العميق (TensorFlow/PyTorch) مع دعم GPU | Python/FastAPI |
| `training-pipeline` | غير مطبق | مسار بايثون لتدريب نماذج (ML/DL) داخلياً على بيانات البورصة المصرية فقط | Python |
| `ollama` | 11434 | نموذج لغة كبير محلي (المرحلة 6 - لمعالجة الأخبار العربية فقط) | Ollama |

*ملاحظة: يعمل EGX-Nexus خلف خادم Nginx داخلي على المنفذ `8080` (وليس `80`) لتجنب التعارض مع الخوادم المشتركة.*

## نظام نقاش وكلاء الذكاء الاصطناعي
يكمن الذكاء الحقيقي لـ EGX-Nexus في بنيته اللامركزية للذكاء الاصطناعي داخل الـ `core-brain`.
- **وكلاء الثيران والدببة (Bull & Bear Agents)**: يستخدمون نماذج (ML) متخصصة ومُدربة داخلياً لتحديد مناطق التجميع/التصريف ومناطق العرض/الطلب.
- **الوكيل الفني (Technical Agent)**: يعتمد بشكل صارم على محرك قواعد حتمي (وايكوف/إليوت) بدون أي استعانة بـ LLM.
- **وكيل المشاعر (Sentiment Agent)**: الوكيل *الوحيد* الذي يستخدم الـ LLM المحلي (Ollama/llama3)، ويقتصر دوره على تحليل الأخبار وإعلانات البورصة المصرية باللغة العربية.
- **مديري النقاش والمخاطر**: يعتمد على التصويت المرجح (70٪ للنماذج المتخصصة، 30٪ للمشاعر) ويطبق قواعد صارمة لحجم الصفقات والحد الأقصى للتراجع المالي قبل تنفيذ أي صفقة.

## المتطلبات والتشغيل
### المتطلبات الأساسية
1. **Docker & Docker Compose**: تأكد من تثبيتهما على جهازك.
2. **بيانات اعتماد الوسيط**: مطلوبة للمصادقة وبث الأسعار اللحظي (`BROKER_USERNAME` / `BROKER_PASSWORD`).
3. **بوت تيليجرام**: ستحتاج إلى Token ومعرف المحادثة (Chat ID).
4. **نموذج لغة كبير محلي**: Ollama محمل عليه `llama3` (للمرحلة 6).

### خطوات التثبيت
1. **نسخ المستودع:**
   ```bash
   git clone https://github.com/your-username/egx-nexus.git
   cd egx-nexus
   ```
2. **تكوين البيئة وتشغيل النظام:**
   ```bash
   cp .env.example .env
   docker-compose up -d
   ```

## خارطة الطريق
- [x] **المرحلة 1** — هيكلة الخدمات المصغرة
- [x] **المرحلة 2** — محرك التوقعات + جامع البيانات
- [x] **المرحلة 3** — تشغيل كامل لـ docker-compose مع فحوصات الصحة
- [ ] **المرحلة 4** — توجيه Nginx وحل تعارض المنافذ (المنفذ 8080)
- [ ] **المرحلة 5** — محرك التحليل: منطق وايكوف وموجات إليوت
- [ ] **المرحلة 6** — Ollama ونظام نقاش الذكاء الاصطناعي
- [ ] **المرحلة 7** — مسار التدريب: تدريب النماذج داخلياً على بيانات السوق المصري
- [ ] **المرحلة 8** — واجهة مستخدم للوحة التحكم
