<h1 align="center">
  <br>
  🎙️ MeetingScribe
  <br>
</h1>

<p align="center">
  <strong>Record. Transcribe. Summarize. — All locally on your machine.</strong>
</p>

<p align="center">
  A lightweight, local-first desktop &amp; web app for PMs and anyone who runs a lot of meetings.<br/>
  Record audio, get AI-powered transcripts with speaker diarization, rename speakers, and generate Minutes of Meeting (MoM) — all powered by Google Gemini or local Whisper.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-Desktop-blue?logo=electron" />
  <img src="https://img.shields.io/badge/React-Vite-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?logo=node.js" />
  <img src="https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite" />
  <img src="https://img.shields.io/badge/Gemini-AI-8E75B2?logo=google" />
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎙️ **Multi-source Audio Recording** | Record from mic (offline meeting), browser tab (Google Meet/online), or virtual audio device (Zoom/Teams via BlackHole) |
| 🤖 **AI Transcription** | Three engines: **Gemini API** (cloud, best quality), **Local Transformers.js** (Whisper in-browser), or **Whisper.cpp** (fast native binary) |
| 👥 **Speaker Diarization** | Automatically labels different speakers (Orang 1, Orang 2, …) — edit to real names inline |
| 📋 **MoM & Recap Generation** | One-click generate a structured Minutes of Meeting or quick recap via Gemini |
| 📅 **Google Calendar Sync** | Import upcoming meetings from Google Calendar via `.ics` feed — auto-synced every 60 seconds |
| 📜 **Meeting History** | Full searchable history of all meetings with transcript and summaries |
| 🔒 **Local-first & Private** | All data (SQLite DB + recordings) lives on your machine. Only Gemini API calls go external |
| 🖥️ **Desktop App** | Ships as a native Electron app (`.dmg` for macOS) with menu bar icon |

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TailwindCSS |
| **Desktop shell** | Electron 43 |
| **Backend** | Node.js + Express |
| **Database** | SQLite via `better-sqlite3` |
| **AI — Cloud** | Google Gemini API (`gemini-2.5-flash`) |
| **AI — Local (option 1)** | `@xenova/transformers` — Whisper running fully in Node.js |
| **AI — Local (option 2)** | `whisper.cpp` — compiled native binary for fast CPU inference |
| **Audio capture** | Web MediaRecorder API + AudioContext mixer |

---

## 📁 Project Structure

```
record-ah/
├── main.js              # Electron main process
├── preload.js           # Electron preload (contextBridge IPC)
├── package.json         # Root: scripts, Electron build config, shared deps
│
├── client/              # React + Vite frontend
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.jsx      # Meeting history list + create modal
│       │   ├── Recording.jsx      # Audio capture & recording controls
│       │   ├── Detail.jsx         # Transcript view, speaker editor, MoM
│       │   └── Settings.jsx       # API key, transcription engine, calendar
│       ├── components/
│       │   ├── FloatingRecordingBar.jsx   # Persistent mini-bar while recording
│       │   ├── VUMeter.jsx                # Live audio level meter
│       │   └── WhisperSetupModal.jsx      # Guided local Whisper model setup
│       ├── context/
│       │   └── RecordingContext.jsx       # Global recording state
│       └── utils/
│           └── audioMixer.js              # AudioContext multi-source mixer
│
└── server/              # Express backend
    ├── .env.example     # Environment variable template
    └── src/
        ├── index.js           # Express app entry + Google Calendar auto-sync
        ├── routes.js          # All API route handlers
        ├── db.js              # SQLite schema + dbHelpers
        ├── gemini.js          # Gemini API integration (transcribe + summarize)
        ├── localWhisper.js    # Transformers.js local Whisper pipeline
        ├── whisperCpp.js      # Whisper.cpp native binary wrapper
        ├── audioUtils.js      # Audio duration repair, format utils
        ├── googleCalendar.js  # iCal feed parser + Google Calendar sync
        └── logger.js          # Structured server-side logger
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- **npm** v9+
- A **Google Gemini API key** — [Get one free at aistudio.google.com](https://aistudio.google.com)

### 1. Clone the repository

```bash
git clone https://github.com/ramcona/meetingscribe.git
cd meetingscribe
```

### 2. Install all dependencies

```bash
npm run install:all
```

This installs root, client, and server dependencies in one go.

### 3. Configure environment variables

```bash
cp server/.env.example server/.env
```

Then open `server/.env` and fill in your values:

```env
PORT=3001
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
APP_NAME=MeetingScribe
```

> **Note:** You can also set the API key later from the **Settings** page inside the app — no need to restart the server.

### 4. Run in development mode

**Web mode** (browser at `http://localhost:5173`):
```bash
npm run dev
```

**Desktop mode** (Electron window):
```bash
npm run dev:desktop
```

---

## 🖥️ Running as Desktop App

### Build the production `.dmg` (macOS)

```bash
npm run build:desktop
```

The output will be in `dist-desktop/`. Open the `.dmg` file and drag MeetingScribe to your Applications folder.

> **macOS Note:** The build disables code signing by default (`CSC_IDENTITY_AUTO_DISCOVERY=false`). If macOS blocks the app, right-click → Open to bypass Gatekeeper on first launch.

---

## 🎙️ Audio Recording Modes

MeetingScribe supports three recording scenarios:

### Mode A — Offline / In-person Meeting

Use your built-in MacBook mic or any external microphone.

1. On the Recording page, select your mic from **"Your Mic"** dropdown
2. Leave "System Audio" empty
3. Hit **Start Recording**

### Mode B — Online Meeting (Google Meet, browser-based)

Captures both the browser tab audio **and** your microphone, mixed together.

1. Select your mic in **"Your Mic"** dropdown
2. Click the **tab icon** to capture a browser tab (Google Meet, etc.)
3. The two streams are automatically mixed before encoding

### Mode C — Online Meeting via Desktop App (Zoom, Teams)

Requires a one-time setup of **BlackHole** (free virtual audio device for macOS):

#### One-time Setup

1. Install [BlackHole 2ch](https://existential.audio/blackhole/) (free, open-source)
2. Open **Audio MIDI Setup** (search in Spotlight)
3. Click `+` → **Create Multi-Output Device**
4. Check both **BlackHole 2ch** and your real speakers/headphones
5. In **System Settings → Sound → Output**, select the Multi-Output Device
6. In Zoom/Teams, set audio output to **BlackHole 2ch**

#### Recording

1. In MeetingScribe, select **BlackHole 2ch** as **"System Audio"**
2. Select your real microphone as **"Your Mic"**
3. Start recording — both streams are mixed automatically

---

## 🤖 Transcription Engines

MeetingScribe supports three transcription backends. Switch in **Settings → Transcription Engine**.

### 1. Gemini API (Cloud) — *Recommended*

- Best accuracy, handles mixed Indonesian/English
- Speaker diarization included (identifies different speakers)
- Requires a Gemini API key and internet connection
- Free tier available at [aistudio.google.com](https://aistudio.google.com)

### 2. Local Whisper (Transformers.js)

- Runs 100% offline using Hugging Face Transformers.js
- Model downloads automatically on first use (~150MB for `tiny`, ~1.5GB for `large`)
- No API key required, no data leaves your machine
- No speaker diarization (single-speaker transcript)

### 3. Whisper.cpp (Native Binary) — *Fastest Local*

- Uses the compiled `whisper.cpp` C++ binary for fast CPU inference
- Setup guide available in **Settings → Whisper.cpp Setup**
- Requires cmake and a C++ compiler for the initial build
- Supports multiple model sizes (tiny, base, small, medium, large)

> **Tip:** Use Gemini API for the best results. Switch to Local/Whisper.cpp when you need full offline privacy.

---

## 📅 Google Calendar Integration

MeetingScribe can sync your upcoming meetings from Google Calendar so you can quickly create meeting entries without typing.

### Setup via iCal Feed (`.ics`)

1. Go to **Google Calendar** → Settings → Settings for my calendars
2. Select your calendar → **"Integrate calendar"**
3. Copy the **Secret address in iCal format**
4. In MeetingScribe → **Settings → Google Calendar**, paste the URL
5. Click **Sync Now** — events will auto-refresh every 60 seconds

You can also manually upload a `.ics` file (exported from any calendar app).

---

## 🗄️ Database Schema

MeetingScribe uses a local SQLite database at `server/data/meetingscribe.db`.

```sql
meetings            -- title, client, status, audio path, duration
transcript_segments -- speaker label/name, text, start/end timestamps
summaries           -- MoM / recap content (markdown)
settings            -- API key, engine preference, calendar URL
calendar_events     -- synced Google Calendar events
```

All data stays on your machine. The database is never uploaded anywhere.

---

## 📡 API Reference

The Express backend exposes the following REST endpoints:

```
# Meetings
GET    /api/meetings                  List all meetings
POST   /api/meetings                  Create a new meeting
GET    /api/meetings/:id              Get meeting detail + transcript + summaries
PATCH  /api/meetings/:id             Update meeting metadata
DELETE /api/meetings/:id             Delete meeting

# Recording & Transcription
POST   /api/meetings/:id/recording   Upload audio file, trigger transcription
GET    /api/meetings/:id/transcript  Get transcript segments
PATCH  /api/transcript/:segmentId   Rename speaker

# Summaries
POST   /api/meetings/:id/summary     Generate MoM or Recap (body: { type })
GET    /api/meetings/:id/summary     Get existing summaries

# Settings
GET    /api/settings                 Get current settings
POST   /api/settings                 Update settings (API key, engine, etc.)

# Calendar
GET    /api/calendar/events          List synced calendar events
POST   /api/calendar/sync            Trigger manual calendar sync
POST   /api/calendar/upload-ics      Upload .ics file

# Whisper.cpp
GET    /api/whisper/status           Check installation status
POST   /api/whisper/install          Build whisper.cpp from source
GET    /api/whisper/models           List downloaded models
POST   /api/whisper/download-model   Download a model (tiny/base/small/...)
```

---

## 🧪 Running Tests

```bash
npm test
```

Runs all test files under `server/tests/` and `client/src/tests/` using Node's built-in test runner.

---

## ⚙️ Available Scripts

| Script | Description |
|---|---|
| `npm run install:all` | Install all dependencies (root + client + server) |
| `npm run dev` | Start frontend + backend in dev mode (web) |
| `npm run dev:desktop` | Start frontend + backend + Electron in dev mode |
| `npm run build:desktop` | Build production Electron app (`.dmg` / `.zip`) |
| `npm run start` | Start only the Express backend |
| `npm test` | Run all tests |

---

## 🔒 Privacy & Security

- **All meeting data is stored locally** on your machine in `server/data/`
- **Audio recordings** are stored locally in `server/data/recordings/`
- The **Gemini API key** is stored locally in the SQLite database or `.env` file — never transmitted except to Google's Gemini API
- **No external tracking, analytics, or telemetry** of any kind
- When using Local Whisper or Whisper.cpp, **zero network calls** are made during transcription

---

## 🐛 Troubleshooting

### App can't access microphone
- macOS: Go to **System Settings → Privacy & Security → Microphone** and allow the browser or MeetingScribe app

### Transcription stuck on "processing"
- Check that your `GEMINI_API_KEY` is valid in `server/.env` or Settings page
- Check the server console for error messages

### BlackHole not showing in dropdown
- Make sure BlackHole 2ch is installed and your Multi-Output Device is active in Audio MIDI Setup
- Try refreshing the device list by clicking the refresh icon on the Recording page

### Whisper.cpp build fails
- Ensure you have `cmake` and Xcode Command Line Tools installed:
  ```bash
  xcode-select --install
  brew install cmake
  ```
- Then retry the setup from Settings → Whisper.cpp Setup

### Database issues
- The SQLite DB is at `server/data/meetingscribe.db`
- To reset everything: delete that file and restart the server (it will be recreated automatically)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT — feel free to use and modify for personal or commercial projects.

---

<p align="center">
  Built with ❤️ for PMs who are tired of taking notes during meetings.
</p>
