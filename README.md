# EGX-Nexus (Egyptian Exchange Nexus)

<p align="center">
  <b>A fully autonomous AI-powered trading intelligence platform tailored for the Egyptian Stock Exchange (EGX).</b><br>
  <i>منصة ذكاء تداول مستقلة ومدعومة بالذكاء الاصطناعي مصممة خصيصًا للبورصة المصرية.</i>
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
**EGX-Nexus** is an independent, ground-up intelligence system designed specifically for traders in Egypt. It combines real-time market data, historical analysis, and a unique **multi-agent AI system** to produce actionable trading decisions (BUY/SELL/HOLD).

Unlike traditional platforms, EGX-Nexus is crafted to make smart financial analytics accessible to individual traders. The platform employs a local-first AI approach, minimizing reliance on external APIs, and integrates robustly with real-time market data providers to ensure an accurate and tailored experience.

## Key Features
- **Real-Time Price Streaming**: Integration with advanced WebSocket technology for live price updates.
- **Historical Data Harvesting**: Automated OHLCV data collection from trusted financial data sources, securely stored in a scalable database.
- **Advanced Technical Analysis**: A powerful framework utilizing techniques such as the Wyckoff Method, Elliott Waves, RSI, and MACD.
- **Multi-Agent AI Decision System**: A cutting-edge system where multiple AI agents collaborate to analyze market conditions and arrive at optimal decisions.
- **Telegram Notifications**: Instant signals, alerts, and system health updates delivered directly to your Telegram channel.
- **EGX-Specific Focus**: Optimized for the Egyptian market, covering over 200 local stocks with native Arabic support.
- **Scalable Microservices Architecture**: Engineered with Docker for reliability and scalability.

## Architecture & Microservices
The platform employs a scalable microservices structure utilizing Docker.

| Service              | Port  | Responsibility                                | Tech Stack     |
|---------------------|-------|---------------------------------------------|---------------|
| `core-brain`        | 3000  | Orchestrator + Agent Manager                | Node.js       |
| `auth-gateway`      | 3001  | Session Management + Authentication         | Node.js       |
| `analysis-engine`   | 3002  | Technical Indicators Analysis               | Node.js       |
| `prediction-engine` | 3003  | Signal Prediction + Market Listening        | Node.js/TS    |
| `data-harvester`    | 3005  | Financial Data Collection                   | Node.js       |
| `notification-hub`  | 3006  | Telegram Notifications Management           | Node.js       |
| `dashboard-api`     | 3007  | Backend for the Web Dashboard               | Node.js       |
| `training-pipeline` | N/A   | Historical Data-Based Machine Learning      | Python        |
| `ollama`            | 11434 | Local AI Model Inference                    | Ollama        |

*Note: EGX-Nexus operates within a secure Nginx proxy environment to prevent conflicts in multi-tenant setups.*

## Prerequisites & Setup
This project targets developers and advanced traders aiming for self-hosted solutions.

### Prerequisites
1. **Docker & Docker Compose**: Ensure both are installed.
2. **Broker Account**: Necessary for real-time data streaming.
3. **Telegram Bot**: Obtain a bot token and chat ID for notifications.
4. **Local LLM**: Install Ollama locally for advanced AI models.
5. **Nginx Proxy Manager**: Configure port forwarding for shared environments.

### Installation Steps
1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/egx-nexus.git
   cd egx-nexus
   ```
2. **Configure Environment Variables:**
   Copy `.env.example` and fill in the required credentials:
   ```bash
   cp .env.example .env
   ```
3. **Run the Application:**
   Launch all services with Docker:
   ```bash
   docker-compose up -d
   ```

## Roadmap
- [x] **Phase 1**: Initial Microservices Setup
- [x] **Phase 2**: Prediction Engine and Data Harvesting Tools
- [x] **Phase 3**: Full Dockerization
- [ ] **Phase 4**: Nginx Setup for Multi-Tenant Support
- [ ] **Phase 5**: Enhance Analysis with Advanced Techniques
- [ ] **Phase 6**: Integrate Multi-Agent AI System (Ollama)
- [ ] **Phase 7**: Implement Machine Learning on Historical Data
- [ ] **Phase 8**: Web-Based Dashboard for User Interaction

---

# 🇪🇬 التوثيق باللغة العربية

## الرؤية والهدف
**EGX-Nexus** هو نظام ذكاء تداول مستقل تم تصميمه خصيصًا لتلبية احتياجات المتداولين الأفراد في مصر. يجمع هذا النظام بين البيانات اللحظية للسوق وأدوات تحليلية متقدمة ونظام ذكاء اصطناعي متعدد الوكلاء لاتخاذ قرارات تداول دقيقة.

على عكس المنصات التقليدية، يقدم EGX-Nexus الأدوات التحليلية بشكل ميسر للأفراد من خلال تقنيات الذكاء الاصطناعي المحلية وتكامل سلس مع البيانات اللحظية لتحقيق تجربة دقيقة وفعالة.

## المميزات الرئيسية
- **تدفق الأسعار اللحظي**: تكامل مع تقنيات WebSocket المتقدمة لتوفير تحديث مستمر للأسعار.
- **جمع البيانات التاريخية**: استخراج آلي للبيانات المالية من مصادر موثوقة وتخزينها في قواعد بيانات قابلة للتطوير.
- **تحليل فني متقدم**: استخدام استراتيجيات تحليلية مثل طريقة وايكوف وموجات إليوت ومؤشرات RSI و MACD.
- **نظام ذكاء اصطناعي لاتخاذ القرارات**: التعاون بين وكلاء ذكاء اصطناعي لتقييم ظروف السوق وتحديد القرارات المثلى.
- **إشعارات تيليجرام**: إرسال تنبيهات مباشرة لحالة النظام والإشارات التحليلية الخاصة بك.
- **تركيز على السوق المصري**: دعم قوي للسوق المحلي بما يزيد عن 200 سهم.
- **بنية تحتية قابلة للتطوير**: تصميم يعتمد على الخدمات المصغرة باستخدام Docker لضمان الأداء العالي.

## البنية التحتية والخدمات المصغرة
تم اعتماد هيكلية خدمات مصغرة باستخدام Docker لتحقيق الكفاءة والتوسعية.

| الخدمة            | المنفذ | المسؤولية                                    | التقنية       |
|------------------|-------|---------------------------------------------|---------------|
| `core-brain`     | 3000  | التنسيق وإدارة وكلاء الذكاء الاصطناعي       | Node.js       |
| `auth-gateway`   | 3001  | إدارة الجلسات ومصادقة المستخدمين            | Node.js       |
| `analysis-engine`| 3002  | تحليل المؤشرات الفنية                       | Node.js       |
| `prediction-engine`| 3003| توقعات الإشارات وتحليل السوق                | Node.js/TS    |
| `data-harvester` | 3005  | جمع البيانات المالية                       | Node.js       |
| `notification-hub`| 3006 | إدارة الإشعارات                             | Node.js       |
| `dashboard-api`  | 3007  | إدارة واجهات المستخدم                      | Node.js       |
| `training-pipeline`| N/A | تدريب التعلم الآلي للبيانات التاريخية       | Python        |
| `ollama`         | 11434 | تنفيذ محلي لنماذج الذكاء الاصطناعي          | Ollama        |

*ملحوظة: يعمل EGX-Nexus ضمن بيئة Nginx آمنة لتجنب تضارب المنافذ.*

##المتطلبات والتشغيل
هذا المشروع مخصص للمطورين والراغبين في الاعتماد على حلول ذاتية الاستضافة.

### المتطلبات الأساسية
1. **Docker & Docker Compose**: تثبيت كلاهما مسبقاً.
2. **حساب وسيط**: مطلوب لتوفير بيانات الأسعار اللحظية.
3. **بوت تيليجرام**: الحصول على توكن البوت ومعرف المستخدم لتفعيل التنبيهات.
4. **نظام ذكاء اصطناعي محلي**: تثبيت Ollama لتوفير التحليل الذكي داخلياً.
5. **إدارة Nginx**: إدارة المنافذ ضمن بيئات مشاركة الخادم.

### خطوات التثبيت
1. **نسخ المستودع:**
   ```bash
   git clone https://github.com/your-username/egx-nexus.git
   cd egx-nexus
   ```
2. **إعداد متغيرات البيئة:**
   نسخ ملف البيئة `.env.example` وتعبئة البيانات المطلوبة:
   ```bash
   cp .env.example .env
   ```
3. **تشغيل النظام:**
   تشغيل جميع الخدمات باستخدام Docker:
   ```bash
   docker-compose up -d
   ```

## خارطة الطريق
- [x] **المرحلة 1**: إعداد الخدمات المصغرة
- [x] **المرحلة 2**: أدوات توقع الإشارات وجمع البيانات
- [x] **المرحلة 3**: تطبيق كامل باستخدام Docker
- [ ] **المرحلة 4**: إعداد Nginx لدعم البيئات المشتركة
- [ ] **المرحلة 5**: تطوير تحليل متقدم للسوق
- [ ] **المرحلة 6**: دمج نظام الذكاء الاصطناعي متعدد الوكلاء
- [ ] **المرحلة 7**: تطبيق التعلم الآلي للبيانات التاريخية
- [ ] **المرحلة 8**: واجهة مستخدم عبر الإنترنت.