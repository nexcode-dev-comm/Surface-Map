/* 
  ✅ AI Screen Explainer - Background Service Worker
  Handles WebSocket connections to Gemini Live (v1beta Bidi API)
*/

let ws = null; 
let isSetupComplete = false;
let connectionAttempts = 0;
const MAX_RETRIES = 3;

// Variable to hold the API key dynamically in memory
let MEMORY_API_KEY = "AIzaSyAUA6gUXsE7nGWlAUVdLxbTgsYyiO03Akk"

// Cache for page text context if it arrives before socket setup is completed
let cachedPageTextContext = null;

// Queue voice data while connecting
const voiceQueue = [];
let isConnecting = false;

/**
 * Retrieves the API key held in memory.
 */
async function getApiKey() {
  if (!MEMORY_API_KEY) {
    throw new Error('API key not configured. Set the variable first.');
  }
  return MEMORY_API_KEY;
}

/**
 * Sends the page context into Gemini's active memory pool
 */
function sendCachedPageContext() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !cachedPageTextContext) return;
  
  console.log("📄 Injecting page layout context text into Gemini context window memory...");
  
  // ✅ FULLY OPTIMIZED & EXPANDED WEB TAB INGESTION PAYLOAD
  const contentPayload = {
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [
            {
              // PART 1: The web tab data layout
              text: `--- START ACCESSIBILITY WEBPAGE CONTENT ---\n${cachedPageTextContext}\n--- END ACCESSIBILITY WEBPAGE CONTENT ---`
            },
            {
              // PART 2: YOUR EXACT RULES
              text: `CRITICAL SYSTEM INSTRUCTION OVERRIDE:
                     1. ACT AS A VOCAL ACCESSIBILITY COMPANION: The user is blind and cannot see their open browser tab. You are their eyes.
                     2. INITIAL SILENCE: Even though you have just received this webpage data, do NOT speak, do NOT welcome the user, and do NOT summarize it yet. Stay completely silent.
                     3. STAND BY: Wait quietly until the user asks a question via their microphone.
                     4. EXPLAIN ON DEMAND: When the user asks a question (e.g., "What's on this page?", "Explain this tab", or asks for specific details), use the webpage text content provided above to verbally explain and paint a clear story of what is on their screen. Keep your spoken language vivid, structured, and easy to navigate by ear.
                     5xnger explanation`
            }
          ]
        }
      ],
      // false guarantees the model ingests the page silently on startup
      turnComplete: false 
    }
  };

  try {
    ws.send(JSON.stringify(contentPayload));
    cachedPageTextContext = null; // Clear cache frame once dispatched cleanly
  } catch (err) {
    console.error("Failed to transmit page context string payload:", err);
  }
}

/**
 * Initializes the WebSocket connection to Gemini Live API
 */
function initWebSocket(port, apiKey) {
  if (isConnecting) return; 
  isConnecting = true;
  connectionAttempts++;

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  
  ws = new WebSocket(url);
  isSetupComplete = false;

  ws.onopen = () => {
    console.log("✅ WebSocket connected. Sending initial setup configuration...");
    
    ws.send(JSON.stringify({
      setup: {
        model: "models/gemini-3.1-flash-live-preview", 
        generationConfig: {
          responseModalities: ["AUDIO"]
        }
      }
    }));
  };

  ws.onmessage = async (event) => {
    try {
      let textData = event.data instanceof Blob ? await event.data.text() : event.data;
      const responseData = JSON.parse(textData);

      if (responseData.setupComplete) {
        console.log("✅ Gemini Live ready! Syncing page details and voice queues...");
        isSetupComplete = true;
        isConnecting = false;
        connectionAttempts = 0; 
        
        // 1. Immediately inject the website text layout context if it's waiting in cache
        sendCachedPageContext();

        // 2. Drain the accumulated microphone loop voice queue
        while (voiceQueue.length > 0) {
          const queuedData = voiceQueue.shift();
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(queuedData));
          }
        }
        return;
      }

      const serverContent = responseData.serverContent;
      if (serverContent?.modelTurn?.parts) {
        for (const part of serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            console.log("📢 Received audio chunk from Gemini...");
            port.postMessage({
              success: true,
              audioData: part.inlineData.data,
              mimeType: "audio/pcm;rate=24000" 
            });
          }
        }
      }
    } catch (err) {
      console.error("❌ Failed to parse WebSocket message:", err);
      port.postMessage({ success: false, error: `Parse error: ${err.message}` });
    }
  };

  ws.onerror = (error) => {
    console.error("❌ WebSocket error experienced:", error);
    isSetupComplete = false;
    isConnecting = false;
    port.postMessage({ success: false, error: `WebSocket error: ${error.message || 'Unknown state'}` });
  };

  ws.onclose = (event) => {
    console.warn(`⚠️ WebSocket closed (code: ${event.code}). Reason: ${event.reason || 'None provided'}`);
    isSetupComplete = false;
    isConnecting = false;

    if (connectionAttempts < MAX_RETRIES) {
      console.log(`Retrying connection handling (${connectionAttempts}/${MAX_RETRIES})...`);
      setTimeout(() => {
        getApiKey()
          .then(key => initWebSocket(port, key))
          .catch(err => {
            console.error("Failed to reconnect automatically:", err);
            port.postMessage({ success: false, error: 'Connection lost. Please interact to re-try.' });
          });
      }, 2000);
    } else {
      port.postMessage({ success: false, error: 'Max connection retries exceeded' });
    }
  };
}

/**
 * Long-lived connection channel handler for the Frontend Popup / UI 
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "gemini-audio-stream") {
    console.log("🔌 React UI connected to background audio channel.");

    getApiKey()
      .then(apiKey => initWebSocket(port, apiKey))
      .catch(err => {
        console.error("❌ Cannot get API key:", err);
        port.postMessage({ success: false, error: 'API key not configured' });
      });

    port.onMessage.addListener((request) => {
      // Handle uncompressed microphone PCM block streaming vectors
      if (request.action === "process_voice_command") {
        const messagePayload = {
          realtimeInput: {
            audio: {
              mimeType: "audio/pcm;rate=16000", 
              data: request.audioData          
            }
          }
        };

        if (!ws || ws.readyState !== WebSocket.OPEN || !isSetupComplete) {
          if (connectionAttempts < MAX_RETRIES) {
            voiceQueue.push(messagePayload);
          }
          return;
        }

        try {
          ws.send(JSON.stringify(messagePayload));
        } catch (err) {
          console.error("Failed to transmit user voice payload:", err);
        }
      }

      // Handle page HTML context ingestion
      if (request.action === "process_page_context") {
        cachedPageTextContext = request.htmlData;
        
        // If the socket pipeline is already fully online, flush it immediately
        if (ws && ws.readyState === WebSocket.OPEN && isSetupComplete) {
          sendCachedPageContext();
        } else {
          console.log("⏳ Context saved to memory cache. Waiting for socket activation handshake...");
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("🔌 Popup context closed. Cleaning up sockets and queues...");
      voiceQueue.length = 0;
      cachedPageTextContext = null;
      if (ws) {
        ws.close();
        ws = null;
      }
    });
  }
});

/**
 * Single message listener for setting global variable states across extension scopes
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SET_API_KEY") {
    MEMORY_API_KEY = message.key;
    console.log("🔑 API Key successfully assigned in background memory variable.");
    sendResponse({ success: true });
  }
});