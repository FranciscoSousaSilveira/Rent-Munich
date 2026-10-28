# Rent Munich (Casas Munique) 🏠🚇

> Automated rental hunting, AI extraction, MVV transit calculation, and instant alert system for the Munich housing market.

[![Test Suite](https://img.shields.io/badge/tests-60%20passed-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-Google%20Apps%20Script%20%7C%20Node.js-blue.svg)]()
[![AI](https://img.shields.io/badge/AI-Google%20Gemini-orange.svg)]()
[![Transit](https://img.shields.io/badge/transit-MVG%20%2F%20MVV%20API-yellow.svg)]()
[![Notifications](https://img.shields.io/badge/alerts-Telegram%20%2B%20Gmail-blueviolet.svg)]()

> **Documentação em Português:** Para o guia detalhado de configuração e regras de negócio em português, consulta o ficheiro [LE-ME.md](LE-ME.md).

---

## 🌟 Overview

Finding rental housing in Munich is notoriously competitive: the best listings often receive dozens of inquiries within the first 10–20 minutes.

**Rent Munich** is an end-to-end automation pipeline that monitors alert emails from major German real estate portals (**WG-Gesucht**, **Immobilienscout24**, and **Immowelt**), scrapes listing details (using a local stealth browser bridge to bypass DataDome and Cloudflare bot protections), extracts structured property facts using **Google Gemini**, automatically queries the **MVG/MVV public transit API** to verify commute times to university/work hubs, applies strict deterministic rental criteria, and sends **instant high-priority Telegram alerts** directly to your phone.

```
                      ┌───────────────────────────────────────────────┐
                      │    Portals: WG-Gesucht / ImmoScout / Immowelt │
                      └───────────────────────┬───────────────────────┘
                                              │ Email alerts
                                              ▼
                      ┌───────────────────────────────────────────────┐
                      │       Gmail Inbox (Label: Rent/Alertas)       │
                      └───────────────────────┬───────────────────────┘
                                              │ Triggered every 5 min
                                              ▼
                      ┌───────────────────────────────────────────────┐
                      │          Google Apps Script (Code.gs)         │
                      └───────┬───────────────┬───────────────┬───────┘
                              │               │               │
        Fetch ad page (direct)│               │Obscura Bridge │Live MVV transit
              ┌───────────────┘               │(DataDome/CF)  │(TUM & Marienplatz)
              ▼                               ▼               ▼
     ┌─────────────────┐             ┌────────────────┐ ┌────────────────┐
     │   WG-Gesucht    │             │ Obscura Server │ │    MVG API     │
     │   HTML Parser   │             │(Rust/V8 Engine)│ │(Door-to-door)  │
     └────────┬────────┘             └────────┬───────┘ └────────┬───────┘
              │                               │                  │
              └───────────────────────┬───────┴──────────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────────────────────┐
                      │       Google Gemini AI Fact Extraction        │
                      └───────────────────────┬───────────────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────────────────────┐
                      │  Deterministic Decision Engine & Filter Rules │
                      │  - Budget ceiling: ≤ 1000 € warm / person     │
                      │  - Target budget:  ≤ 800 € warm / person      │
                      │  - Fitted kitchen (EBK): MANDATORY            │
                      │  - Long-term (unbefristet): MANDATORY         │
                      │  - Max commute: TUM ≤ 60 min, City ≤ 45 min   │
                      │  - Auto-reject: Tauschwohnung / Swaps / 404s  │
                      └───────┬───────────────────────────────┬───────┘
                              │ Approved                      │ Stale / Rejected
                              ▼                               ▼
                      ┌───────────────────────┐       ┌───────────────┐
                      │ Instant Telegram Alert│       │ Drop / Archive│
                      │   + HTML Digest Email │       └───────────────┘
                      └───────────────────────┘
```

---

## ✨ Features

- **Multi-Portal Support**: Reads listing emails and extracts full pages from **WG-Gesucht**, **ImmoScout24**, and **Immowelt**.
- **Anti-Bot Stealth Scraper (Obscura)**: Integrates [Obscura](https://github.com/h4ckf0r0day/obscura), a high-performance Rust/V8 headless engine capable of bypassing DataDome (ImmoScout24) and Cloudflare (Immowelt) protections.
- **AI-Powered Fact Extraction**: Uses Gemini Flash to pull raw facts (room count, layout, Cold/Warm/Nebenkosten rents, kitchen presence, move-in dates, and quotes) into a strictly validated JSON schema.
- **Automated MVG/MVV Commute Calculation**:
  - Live door-to-door public transit routing via the official MVG API.
  - Automatically checks morning rush-hour transit times to **TUM Garching Campus** ($\le 60\text{ min}$) and **Marienplatz** ($\le 45\text{ min}$).
  - Detects direct connections via the **U6** line and boosts ranking priority.
  - Automatically rejects listings exceeding transit thresholds.
- **Strict Business & Filter Rules**:
  - Excludes swap/exchange-only listings (*Tauschwohnung*, *Wohnungsswap*, *Wohnungstausch*).
  - Enforces mandatory fitted kitchen (*Einbauküche / EBK*).
  - Enforces long-term contracts (*unbefristet*).
  - Calculates per-person rent accurately across 1-, 2-, 3-person apartments and WG rooms.
  - Discards stale alerts older than 24 hours.
- **Instant Telegram Push Notifications**: Alerts arrive with formatted HTML summaries, commute breakdowns, key facts, and interactive inline buttons for direct access.
- **Zero-Cloud-Cost Fallback**: Works completely within free tier limits (Gemini API Free Tier + Google Apps Script quotas). If the Obscura local bridge is offline, the system falls back gracefully to analyzing email bodies without failing.
- **Comprehensive Test Suite**: 60 offline unit tests covering edge cases, deduplication, price splitting, transit rejection, and parsing logic.

---

## 📁 Repository Structure

```
Rent Munich/
├── Code.gs                   # Google Apps Script core (decision rules, Gemini, MVG, Telegram)
├── appsscript.json           # Apps Script manifest (Europe/Berlin timezone, scopes)
├── package.json              # Project dependencies, scripts, and metadata
├── LE-ME.md                  # Comprehensive documentation in Portuguese
├── extractor/
│   ├── server.cjs            # Local bridge HTTP server (port 8088)
│   ├── download-obscura.cjs  # Automated downloader for Obscura binary
│   ├── parsers.cjs           # HTML and JSON-LD parsers for ImmoScout24 & Immowelt
│   └── cli.cjs               # CLI utility to test extraction and MVV routing
├── scripts/
│   └── scrape-munich-ad.mjs  # Standalone CLI ad scraper, evaluator, and Telegram sender
└── tests/
    ├── filter.test.cjs       # 60 unit tests for business logic, routing, and notifications
    ├── parsers.test.cjs      # Tests for HTML/JSON-LD parsers
    └── scrape-script.test.mjs# Tests for standalone scraper CLI
```

---

## 🚀 Quick Start & Installation

### 1. Prerequisites

- **Node.js**: v18+ installed locally.
- **Google Account**: For Google Apps Script and Gmail alerts.
- **Google AI Studio**: Free API key for Gemini.
- **Telegram Bot**: (Optional, recommended) Token from `@BotFather`.

### 2. Local Setup & Testing

Clone the repository and run the test suite:

```powershell
# Run the complete test suite (60 unit tests + parsers + CLI)
npm run test:all
```

To set up the local Obscura stealth browser engine (for ImmoScout24 / Immowelt page extraction):

```powershell
# Download the stealth binary to bin/obscura.exe
npm run setup:obscura

# Start the local extractor bridge (runs on http://localhost:8088)
npm run extractor
```

---

## ⚙️ Google Apps Script Configuration

1. Open [Google Apps Script](https://script.google.com/) and create a project named **Casas Munique**.
2. Copy the content of [`Code.gs`](Code.gs) into the script editor.
3. In Project Settings, enable **Show "appsscript.json" manifest file in editor** and paste the content of [`appsscript.json`](appsscript.json).
4. Under **Project Settings > Script Properties**, configure:

| Property | Description | Required | Example |
|---|---|:---:|---|
| `GEMINI_API_KEY` | Google Gemini API key from AI Studio | **Yes** | `AIzaSy...` |
| `FREE_TIER_CONFIRMED` | Confirmation to stick to free-tier usage | **Yes** | `SIM` |
| `EXTRACTOR_URL` | Public URL of your Obscura bridge (via tunnel) | No | `https://my-tunnel.trycloudflare.com` |
| `EXTRACTOR_TOKEN` | Bearer token if configured in bridge | No | `secret_token` |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token from `@BotFather` | No | `123456:ABC-DEF...` |
| `TELEGRAM_CHAT_ID` | Your Telegram user or group ID | No | `123456789` |

5. Run the **`preparar`** function once and authorize permissions. This creates the Gmail label `Rent/Alertas`.
6. Set up Gmail filters for incoming alert emails from WG-Gesucht, Immowelt, and ImmoScout24 to automatically assign the label `Rent/Alertas`.
7. Test the setup:
   - Run **`testar`**: processes recent alerts in preview mode and generates a private HTML review in Google Drive.
   - Run **`testarTelegram`**: sends a test card to your Telegram.
   - Run **`testarPercursoMVV`**: verifies MVV transit calculations.
8. Activate automation:
   - Run **`ativar`**: sets up an automatic trigger to run every 5 minutes.
   - Run **`parar`** at any time to pause automated checks.

---

## 🎯 Filtering & Evaluation Criteria

| Criterion | Rule | Action if Not Met |
|---|---|---|
| **Contract Type** | Long-term (*unbefristet*) only | **Rejected** if temporary / Zwischenmiete |
| **Move-in Date** | From January 1, 2027 onwards (negotiable if earlier) | Flagged for review |
| **Swaps / Exchanges** | *Tauschwohnung*, *Wohnungsswap*, *Wohnungstausch* | **Auto-rejected** |
| **Budget (Target)** | $\le 800\text{ €}$ total warm rent per person | Ranked higher |
| **Budget (Ceiling)** | $\le 1000\text{ €}$ total warm rent per person | **Auto-rejected** if $> 1000\text{ €}$ |
| **Kitchen (EBK)** | Fitted kitchen (*Einbauküche*) present | **Rejected** if explicitly missing |
| **Commute: TUM Garching** | $\le 60\text{ min}$ during morning peak | **Auto-rejected** if $> 60\text{ min}$ |
| **Commute: Marienplatz** | $\le 45\text{ min}$ during morning peak | **Auto-rejected** if $> 45\text{ min}$ |
| **Direct U6 Connection** | Direct line without transfers | Boosts priority score |
| **Alert Freshness** | Received within last 24 hours | Discarded as `STALE` if older |

---

## 🛠️ CLI Utilities

### Test Extraction on a Single Listing
```powershell
node extractor/cli.cjs "https://www.immobilienscout24.de/expose/12345678"
```

### Test MVV Transit for an Address
```powershell
node extractor/cli.cjs --transit "Leopoldstraße 50, München"
```

### Full Ad Scrape, AI Evaluation, and Telegram Push
```powershell
$env:GEMINI_API_KEY="your_api_key"
$env:TELEGRAM_BOT_TOKEN="your_token"
$env:TELEGRAM_CHAT_ID="your_chat_id"
node scripts/scrape-munich-ad.mjs "https://www.wg-gesucht.de/wg-zimmer-in-Muenchen.123456.html" --gemini --telegram
```

---

## 🧪 Testing

The repository includes a comprehensive, 100% mocked offline test suite with no external API calls:

```powershell
# Unit tests for Apps Script decision logic (60 tests)
npm test

# Complete test suite (unit + HTML parsers + CLI scraper)
npm run test:all
```

---

## 📄 License

ISC License.
