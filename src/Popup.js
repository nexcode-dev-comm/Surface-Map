/* global chrome */
import React, { useState, useEffect, useRef } from 'react';
import './Popup.css';

export default function Popup() {
  const [status, setStatus] = useState('Idle');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState('');
  
  const portRef = useRef(null);
  const streamRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  
  // Audio playback context
  const audioCtxRef = useRef(null);
  const nextStartTimeRef = useRef(0);

  useEffect(() => {
    // Connect to background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connect) {
      console.log("Connecting to background.js...");
      portRef.current = chrome.runtime.connect({ name: "gemini-audio-stream" });

      portRef.current.onMessage.addListener((response) => {
        if (!response.success) {
          console.error("Backend error:", response.error);
          setError(response.error || 'Unknown error');
          setStatus(`Error: ${response.error}`);
          stopEverything();
          return;
        }

        if (response.audioData) {
          setStatus('AI is responding... ✨');
          playAudioChunk(response.audioData);
        }
      });
    }

    return () => {
      stopEverything();
      if (portRef.current) portRef.current.disconnect();
    };
  }, []);

  // Helper: Convert Float32 array from mic to Int16 PCM Base64 safely
  const serializeFloat32ToInt16Base64 = (float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // true = little endian
    }
    
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Play incoming 24kHz PCM chunks from Gemini with safe byte alignment
  const playAudioChunk = async (base64Data) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        nextStartTimeRef.current = audioCtxRef.current.currentTime;
      }

      const binaryString = atob(base64Data);
      const buffer = new ArrayBuffer(binaryString.length);
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const dataView = new DataView(buffer);
      const int16Length = buffer.byteLength / 2;
      const float32Array = new Float32Array(int16Length);
      
      for (let i = 0; i < int16Length; i++) {
        float32Array[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }

      const audioBuffer = audioCtxRef.current.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = audioCtxRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtxRef.current.destination);

      if (nextStartTimeRef.current < audioCtxRef.current.currentTime) {
        nextStartTimeRef.current = audioCtxRef.current.currentTime;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    } catch (err) {
      console.error("Audio playback error:", err);
    }
  };

  const startListening = async () => {
    setError('');
    setStatus('Initializing Audio Streams... 🎤');

    try {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      nextStartTimeRef.current = audioCtxRef.current.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const source = audioCtxRef.current.createMediaStreamSource(stream);
      const processor = audioCtxRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtxRef.current.destination);
processor.onaudioprocess = (e) => {
  if (!portRef.current) {
    console.log("⏸️ Mic recording, but portRef.current is empty/null!");
    return;
  }
  
  const inputData = e.inputBuffer.getChannelData(0); 
  
  // Let's see if the mic is actually picking up any sound volume
  const maxVolume = Math.max(...inputData.slice(0, 100));
  console.log(`🎙️ Mic chunk captured. Max amplitude sample: ${maxVolume}`);

  const pcmBase64 = serializeFloat32ToInt16Base64(inputData);
  
  console.log("✈️ Dispatched base64 audio packet to background.js");
  portRef.current.postMessage({
    action: "process_voice_command",
    audioData: pcmBase64
  });
};
      setIsListening(true);
      setStatus('Listening... Speak now 🎙️');
    } catch (err) {
      console.error('Microphone initialization error:', err);
      setError(err.message);
      setStatus('Microphone connection failed');
    }
  };

  const stopListening = () => {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsListening(false);
  };

  const stopEverything = () => {
    stopListening();
    setStatus('Idle');
  };

  return (
    <div className="popup-container">
      <header className="popup-header">
        <h1>AI Voice Assistant</h1>
      </header>
      <main className="popup-content">
        <div className="status-box"><strong>Status:</strong> {status}</div>
        {error && <div className="error-box"><strong>⚠️ Error:</strong> {error}</div>}
        <button 
          className={`btn btn-primary ${isListening ? 'listening' : ''}`} 
          onClick={isListening ? stopEverything : startListening}
        >
          {isListening ? '⏸ Stop / Finish' : '▶ Start Voice Control'}
        </button>
      </main>
    </div>
  );
}