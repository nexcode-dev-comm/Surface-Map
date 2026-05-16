# 👁️ AI Screen Explainer — Vocal Accessibility Companion

[![Chrome Extension](https://img.shields.io/badge/Platform-Chrome%20Extension-blue.svg)](https://developer.chrome.com/docs/extensions)
[![React](https://img.shields.io/badge/Frontend-React-61dafb.svg)](https://react.dev/)
[![Gemini](https://img.shields.io/badge/AI-Gemini%20Live%20Preview-orange.svg)](https://ai.google.dev/)

**AI Screen Explainer** is an intelligent, real-time voice accessibility companion built to serve as "eyes" for blind and visually impaired individuals. Operating as a Google Chrome Extension powered by a React frontend and the **Gemini 3.1 Flash Live Preview (Bidi) API**, this tool dynamically translates active webpage layout structures into smooth, context-aware, bidirectional conversational audio.

---

## 🌟 Core Features

* **Bidirectional Live Voice Streams:** Captures 16kHz microphone inputs via standard web audio streaming pipelines, serializing the data into Int16 PCM Base64 chunks transmitted straight over a WebSocket to Gemini's low-latency audio model.
* **On-Demand Page Analysis:** Omits messy, unreadable raw HTML code clusters and automatically extracts readable text content (`document.body.innerText`) to build an optimized spatial understanding of the screen.
* **Intelligent Silent Synchronization:** Syncs the current webpage data directly to the AI's short-term session buffer silently upon loading. The companion remains completely quiet until explicitly asked a question.
* **Vocal Browser Control Integration:** Intercepts silent command markers embedded in the AI's textual responses to trigger native browser navigation actions dynamically based on user voice intent:
  * `##ACTION:back##` — Go back to the previous webpage.
  * `##ACTION:forward##` — Advance forward through history.
  * `##ACTION:reload##` — Refresh/reload the current layout frame.
  * `##ACTION:scroll_up##` / `##ACTION:scroll_down##` — Scroll cleanly up or down on the tab.

---

## 🏗️ Architecture & Pipeline Flow

The system splits operational logic completely between isolated Chrome execution layers using a persistent messaging port to prevent data drops when navigating between separate domains:

1. **The User View (React Frontend Panel):** Captures multi-channel live speech recordings, decodes incoming 24kHz multi-channel response arrays from the backend port, handles layout rendering logic, and scrapes webpage boundaries using automated queries.
2. **The Backbone (Background Service Worker):** Holds long-lived WebSocket handles (`wss://`) active throughout entire browsing sessions. It manages request queues when connection frames drop and controls Gemini Live configuration setups.
