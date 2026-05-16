let MEMORY_API_KEY = "AIzaSyBxe3SzZFHDOnjPjVyRDntSHa_4slrbdhM";

let ws = null; 
let isSetupComplete = false;
let connectionAttempts = 0;
const MAX_RETRIES = 3;



let cachedPageTextContext = null;

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
  
  console.log("📄 Injecting page layout context into Gemini context window memory...");
  
  const contentPayload = {
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [
            {
              text: `--- START ACCESSIBILITY WEBPAGE CONTENT ---\n${cachedPageTextContext}\n--- END ACCESSIBILITY WEBPAGE CONTENT ---`
            },
            {
              text: `CRITICAL SYSTEM INSTRUCTION OVERRIDE:
                     1. ACT AS A VOCAL ACCESSIBILITY COMPANION: The user is blind and cannot see their open browser tab. You are their eyes.
                     
                     2. INITIAL SILENCE: Even though you have just received this webpage data, do NOT speak, do NOT welcome the user, and do NOT summarize it yet. Stay completely silent.
                     
                     3. STAND BY: Wait quietly until the user asks a question via their microphone.
                     
                     4. EXPLAIN ON DEMAND: When the user asks a question (e.g., "What's on this page?", "Explain this tab", or asks for specific details), use the webpage text content provided above to verbally explain and paint a clear story of what is on their screen. Keep your spoken language vivid, structured, and easy to navigate by ear.
                     
                     5. KEEP RESPONSES CONCISE: Do not over-explain. Give clear, structured, and not overly long explanations.
                     
                     6. NAVIGATION ACTIONS: If the user says anything related to navigation or scrolling, you must do TWO things simultaneously:
                        - FIRST: Speak a short confirmation out loud to the user in their language.
                        - SECOND: Include one of these exact silent markers in your text response:
                        
                          ##ACTION:back##         — go back (e.g. "go back", "назад", "вернись", "сделай назад", "сделай в заде")
                          ##ACTION:forward##      — go forward (e.g. "go forward", "вперёд", "иди вперёд")
                          ##ACTION:reload##       — reload page (e.g. "reload", "refresh", "обнови", "перезагрузи")
                          ##ACTION:scroll_up##    — scroll up (e.g. "scroll up", "вверх", "листай вверх", "иди вверх")
                          ##ACTION:scroll_down##  — scroll down (e.g. "scroll down", "вниз", "листай вниз", "иди вниз")
                        
                        Examples:
                        - User says "назад давай" → confirm "Going back" → include ##ACTION:back##
                        - User says "scroll down" → confirm "Scrolling down" → include ##ACTION:scroll_down##
                        - User says "вверх" → confirm "Scrolling up" → include ##ACTION:scroll_up##
                        - User says "сделай в заде" → understand they mean go back → confirm "Going back" → include ##ACTION:back##`
            }
          ]
        }
      ],
      turnComplete: false 
    }
  };

  try {
    ws.send(JSON.stringify(contentPayload));
    cachedPageTextContext = null;
  } catch (err) {
    console.error("Failed to transmit page context payload:", err);
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
        
        // Inject cached page context immediately
        sendCachedPageContext();

        // Drain queued voice messages
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
          
          // Handle audio response chunks
          if (part.inlineData?.data) {
            console.log("📢 Received audio chunk from Gemini...");
            port.postMessage({
              success: true,
              audioData: part.inlineData.data,
              mimeType: "audio/pcm;rate=24000" 
            });
          }

          // Handle navigation action markers in text response
          if (part.text) {
            console.log("📝 Text part from Gemini:", part.text);
            const actionMatch = part.text.match(/##ACTION:(\w+)##/);
            if (actionMatch) {
              const action = actionMatch[1]; // "back", "forward", "reload", "scroll_up", "scroll_down"
              console.log(`🎯 Navigation action detected: ${action}`);
              port.postMessage({
                success: true,
                action: action
              });
            }
          }

        }
      }
    } catch (err) {
      console.error("❌ Failed to parse WebSocket message:", err);
      port.postMessage({ success: false, error: `Parse error: ${err.message}` });
    }
  };

  ws.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
    isSetupComplete = false;
    isConnecting = false;
    port.postMessage({ success: false, error: `WebSocket error: ${error.message || 'Unknown state'}` });
  };

  ws.onclose = (event) => {
    console.warn(`⚠️ WebSocket closed (code: ${event.code}). Reason: ${event.reason || 'None provided'}`);
    isSetupComplete = false;
    isConnecting = false;

    if (connectionAttempts < MAX_RETRIES) {
      console.log(`Retrying connection (${connectionAttempts}/${MAX_RETRIES})...`);
      setTimeout(() => {
        getApiKey()
          .then(key => initWebSocket(port, key))
          .catch(err => {
            console.error("Failed to reconnect:", err);
            port.postMessage({ success: false, error: 'Connection lost. Please interact to retry.' });
          });
      }, 2000);
    } else {
      port.postMessage({ success: false, error: 'Max connection retries exceeded.' });
    }
  };
}

/**
 * Long-lived connection handler for the Frontend Popup / UI
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "gemini-audio-stream") {
    console.log("🔌 React UI connected to background audio channel.");

    getApiKey()
      .then(apiKey => initWebSocket(port, apiKey))
      .catch(err => {
        console.error("❌ Cannot get API key:", err);
        port.postMessage({ success: false, error: 'API key not configured.' });
      });

    port.onMessage.addListener((request) => {

      // Stream microphone PCM audio to Gemini
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
          console.error("Failed to transmit voice payload:", err);
        }
      }

      // Ingest page HTML context
      if (request.action === "process_page_context") {
        cachedPageTextContext = request.htmlData;
        
        if (ws && ws.readyState === WebSocket.OPEN && isSetupComplete) {
          sendCachedPageContext();
        } else {
          console.log("⏳ Page context cached. Waiting for socket handshake...");
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("🔌 Popup closed. Cleaning up sockets and queues...");
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
 * One-time message listener for setting the API key globally
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SET_API_KEY") {
    MEMORY_API_KEY = message.key;
    console.log("🔑 API key assigned to background memory.");
    sendResponse({ success: true });
  }
});

