/* 
  ✅ AI Screen Explainer - Background Service Worker
  Handles WebSocket connections to Gemini Live (v1beta Bidi API)
*/

let ws = null; 
let isSetupComplete = false;
let connectionAttempts = 0;
const MAX_RETRIES = 3;

// Variable to hold the API key dynamically in memory
let MEMORY_API_KEY = "AIzaSyCz1ye_vzXDa35mh-dA6PCCNeIgkMlD2OE";

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
  
  const contentPayload = {
    clientContent: {
      turns: [{
        role: "user",
        parts: [{
          text: `CONTEXT WINDOW SYSTEM DATA UPDATE: The user is looking at a webpage with the following text content. Save this inside your current session history. Use this text context to answer all future questions if the user mentions 'this tab', 'this page', or asks you to explain/summarize what they are looking at:\n\n--- WEBPAGE READABLE TEXT ---\n${cachedPageTextContext}`
        }]
      }],
      turnComplete: false // false tells Gemini to ingest it silently without cutting off mic paths
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