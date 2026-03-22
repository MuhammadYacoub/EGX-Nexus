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
  - [Prerequisites & Setup](#prerequisites--setup)
  - [Roadmap](#roadmap)
- [التوثيق باللغة العربية](#-التوثيق-باللغة-العربية)
  - [الرؤية والهدف](#الرؤية-والهدف)
  - [المميزات الرئيسية](#المميزات-الرئيسية)
  - [البنية التحتية والخدمات المصغرة](#البنية-التحتية-والخدمات-المصغرة)
  - [المتطلبات والتشغيل](#المتطلبات-والتشغيل)
  - [خارطة الطريق](#خارطة-الطريق)

---

# 🇬🇧 English Documentation

## Vision & Purpose
**EGX-Nexus** is an independent, ground-up intelligence system built by an Egyptian developer for Egyptian traders. It combines real-time market data, historical OHLCV analysis, and a unique **Multi-Agent AI Debate System** to produce actionable BUY/SELL/HOLD decisions.

Unlike traditional platforms, EGX-Nexus is designed to make smart financial analysis accessible to retail traders—not just large institutions. It utilizes a local-first AI approach (via Ollama) eliminating reliance on paid APIs like OpenAI, and integrates deeply with real brokers like Thndr for Egyptian market context.

## Key Features
- **Real-Time Price Streaming**: Deep integration with TradingView WebSockets via Thndr broker credentials.
- **Historical Data Harvesting**: Automated OHLCV data collection from Yahoo Finance, securely stored in MySQL.
- **Advanced Technical Analysis**: Deep analytical framework relying on the Wyckoff Method, Elliott Waves, RSI, and MACD.
- **Multi-Agent AI Debate System**: A revolutionary approach where a Bull Agent, Bear Agent, and Technical Agent debate market conditions. A Risk Manager evaluates the debate to output a final decision. Powered entirely by a local Ollama LLM.
- **Telegram Notifications**: Real-time signals, alerts, and system health updates delivered straight to your Telegram.
- **EGX-Specific Focus**: Native support and Arabic market context for all 200+ Egyptian stocks.
- **Production-Ready Docker Architecture**: A clean, scalable microservices approach.

## Architecture & Microservices
The platform is built on a scalable microservices architecture utilizing Docker.

| Service | Port | Responsibility | Tech Stack |
|---------|------|----------------|------------|
| `core-brain` | 3000 | Orchestrator + Agent Debate Manager | Node.js |
| `auth-gateway` | 3001 | Session management + TradingView auth | Node.js |
| `analysis-engine` | 3002 | Technical indicators: Wyckoff, Elliott, RSI, MACD | Node.js |
| `prediction-engine` | 3003 | TradingView WebSocket listener + signal publisher | Node.js/TypeScript |
| `data-harvester` | 3005 | Yahoo Finance OHLCV collector, cron daily at 7 PM Cairo time | Node.js |
| `notification-hub` | 3006 | Telegram alerts publisher | Node.js |
| `dashboard-api` | 3007 | REST API for UI and dashboard | Node.js |
| `training-pipeline` | N/A | Python ML model training on historical EGX data | Python |
| `ollama` | 11434 | Local LLM inference (Planned for Phase 6) | Ollama |

*Note: EGX-Nexus runs behind an internal Nginx proxy on port `8080` (not `80`) to avoid conflicts with shared server environments using Nginx Proxy Manager (NPM).*

## Prerequisites & Setup
This project is intended for developers and technical traders looking to self-host the system.

### Prerequisites
1. **Docker & Docker Compose**: Ensure both are installed on your machine.
2. **Thndr Account**: Required for TradingView WebSocket authentication (`TV_USERNAME` / `TV_PASSWORD`).
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
   *Make sure to update your Thndr credentials, Telegram tokens, and database passwords.*

3. **Run the Infrastructure:**
   Start all microservices in detached mode:
   ```bash
   docker-compose up -d
   ```

## Roadmap
- [x] **Phase 1** — Microservices scaffold
- [x] **Phase 2** — prediction-engine + data-harvester
- [x] **Phase 3** — Full docker-compose with healthchecks
- [ ] **Phase 4** — Nginx routing + port conflict resolution
- [ ] **Phase 5** — analysis-engine: Wyckoff + Elliott logic
- [ ] **Phase 6** — Ollama + Multi-Agent Debate System
- [ ] **Phase 7** — Training pipeline: ML on EGX data
- [ ] **Phase 8** — Dashboard UI

---

# 🇪🇬 التوثيق باللغة العربية

## الرؤية والهدف
**EGX-Nexus** هو نظام ذكاء تداول مستقل تم بناؤه من الصفر بواسطة مطور مصري خصيصاً للمتداولين في السوق المصري. يجمع النظام بين بيانات السوق اللحظية، والتحليل التاريخي (OHLCV)، ونظام فريد **للنقاش بين وكلاء الذكاء الاصطناعي (Multi-Agent AI Debate System)** لإنتاج قرارات تداول قابلة للتنفيذ (شراء/بيع/احتفاظ).

على عكس المنصات التقليدية، تم تصميم EGX-Nexus لجعل التحليل المالي الذكي متاحاً للمتداولين الأفراد، وليس فقط للمؤسسات الكبرى. يعتمد النظام على نهج الذكاء الاصطناعي المحلي (عبر Ollama) للتخلص من الاعتماد على واجهات برمجة التطبيقات المدفوعة مثل OpenAI، ويتكامل بعمق مع وسطاء حقيقيين مثل ثاندر (Thndr) لتوفير سياق دقيق للسوق المصري.

## المميزات الرئيسية
- **بث الأسعار اللحظي**: تكامل عميق مع WebSockets الخاصة بـ TradingView عبر بيانات اعتماد وسيط ثاندر (Thndr).
- **جمع البيانات التاريخية**: جمع آلي لبيانات OHLCV من Yahoo Finance وتخزينها بأمان في قاعدة بيانات MySQL.
- **تحليل فني متقدم**: إطار تحليلي عميق يعتمد على طريقة وايكوف (Wyckoff Method)، وموجات إليوت (Elliott Waves)، ومؤشرات RSI و MACD.
- **نظام نقاش وكلاء الذكاء الاصطناعي**: نهج ثوري حيث يتناقش وكيل الثيران (Bull Agent)، ووكيل الدببة (Bear Agent)، والوكيل الفني (Technical Agent) حول ظروف السوق. ثم يقوم مدير المخاطر (Risk Manager) بتقييم النقاش لإصدار القرار النهائي. يعمل النظام بالكامل محلياً عبر نموذج Ollama.
- **إشعارات تيليجرام**: إشارات لحظية، وتنبيهات، وتحديثات لحالة النظام تُرسل مباشرة إلى حسابك على تيليجرام.
- **تركيز خاص بالبورصة المصرية**: دعم أصلي وسياق سوق باللغة العربية لجميع الأسهم المصرية التي يزيد عددها عن 200 سهم.
- **بنية تحتية جاهزة للإنتاج (Docker)**: بنية خدمات مصغرة (Microservices) نظيفة وقابلة للتطوير.

## البنية التحتية والخدمات المصغرة
تم بناء المنصة على بنية خدمات مصغرة قابلة للتطوير باستخدام Docker.

| الخدمة (Service) | المنفذ (Port) | المسؤولية (Responsibility) | التقنية (Tech Stack) |
|------------------|---------------|----------------------------|----------------------|
| `core-brain` | 3000 | المنسق الأساسي + مدير نقاش وكلاء الذكاء الاصطناعي | Node.js |
| `auth-gateway` | 3001 | إدارة الجلسات + المصادقة مع TradingView | Node.js |
| `analysis-engine` | 3002 | المؤشرات الفنية: وايكوف، إليوت، RSI، MACD | Node.js |
| `prediction-engine` | 3003 | مستمع TradingView WebSocket + ناشر الإشارات | Node.js/TypeScript |
| `data-harvester` | 3005 | جامع بيانات Yahoo Finance OHLCV، يعمل يومياً الساعة 7 مساءً بتوقيت القاهرة | Node.js |
| `notification-hub` | 3006 | ناشر تنبيهات تيليجرام | Node.js |
| `dashboard-api` | 3007 | واجهة برمجة تطبيقات (REST API) لواجهة المستخدم ولوحة التحكم | Node.js |
| `training-pipeline` | غير مطبق | تدريب نماذج تعلم الآلة (ML) على بيانات البورصة المصرية | Python |
| `ollama` | 11434 | استنتاج نماذج اللغة الكبيرة (LLM) محلياً (مخطط للمرحلة 6) | Ollama |

*ملاحظة: يعمل EGX-Nexus خلف خادم Nginx داخلي على المنفذ `8080` (وليس `80`) لتجنب التعارض مع بيئات الخوادم المشتركة التي تستخدم Nginx Proxy Manager (NPM).*

## المتطلبات والتشغيل
هذا المشروع موجه للمطورين والمتداولين التقنيين الذين يرغبون في استضافة النظام بأنفسهم.

### المتطلبات الأساسية
1. **Docker & Docker Compose**: تأكد من تثبيتهما على جهازك.
2. **حساب ثاندر (Thndr)**: مطلوب للمصادقة مع TradingView WebSocket (`TV_USERNAME` / `TV_PASSWORD`).
3. **بوت تيليجرام**: ستحتاج إلى Token خاص ببوت تيليجرام ومعرف المحادثة (Chat ID) الخاص بك لاستقبال التنبيهات.
4. **نموذج لغة كبير محلي (Local LLM)**: يجب تثبيت Ollama وتشغيله محلياً مع تحميل نموذج `llama3` (مطلوب للمرحلة 6).
5. **Nginx Proxy Manager (NPM)**: الوعي بإعدادات منافذ الخوادم المشتركة.

### خطوات التثبيت
1. **نسخ المستودع (Clone):**
   ```bash
   git clone https://github.com/your-username/egx-nexus.git
   cd egx-nexus
   ```
2. **تكوين متغيرات البيئة:**
   قم بنسخ ملف البيئة التجريبي وأدخل بيانات الاعتماد الخاصة بك:
   ```bash
   cp .env.example .env
   ```
   *تأكد من تحديث بيانات اعتماد ثاندر، وتوكن تيليجرام، وكلمات مرور قواعد البيانات.*

3. **تشغيل البنية التحتية:**
   قم بتشغيل جميع الخدمات المصغرة في الخلفية:
   ```bash
   docker-compose up -d
   ```

## خارطة الطريق
- [x] **المرحلة 1** — هيكلة الخدمات المصغرة (Microservices scaffold)
- [x] **المرحلة 2** — محرك التوقعات + جامع البيانات (prediction-engine + data-harvester)
- [x] **المرحلة 3** — تشغيل كامل لـ docker-compose مع فحوصات الصحة (healthchecks)
- [ ] **المرحلة 4** — توجيه Nginx + حل تعارض المنافذ
- [ ] **المرحلة 5** — محرك التحليل (analysis-engine): منطق وايكوف + موجات إليوت
- [ ] **المرحلة 6** — Ollama + نظام نقاش وكلاء الذكاء الاصطناعي
- [ ] **المرحلة 7** — مسار التدريب (Training pipeline): تعلم الآلة على بيانات البورصة المصرية
- [ ] **المرحلة 8** — واجهة مستخدم للوحة التحكم (Dashboard UI)
