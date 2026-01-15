"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import VoiceMeter from "./VoiceMeter";
import { dispatchPanelAction, isPanelAction } from "./panelBus";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/**
 * 智能助手面板组件
 * 集成了语音通话和文字聊天两种交互模式
 * @returns {JSX.Element} 助手面板组件
 * @keyword-en AssistantPanel, voiceAssistant, aiChat, voiceInteraction
 */
export default function AssistantPanel() {
  const [mode, setMode] = useState<"voice" | "chat">("voice");
  const [call, setCall] = useState<"idle" | "active">("idle");
  const callRef = useRef<"idle" | "active">("idle");
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const interimRef = useRef<string>("");
  const finalsRef = useRef<string[]>([]);
  type Msg = { id: string; role: "assistant" | "user"; text: string; status: "pending" | "sent" };
  const [messages, setMessages] = useState<Msg[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const speechDefault = "aliyun";

  const [aiText, setAiText] = useState("");
  const [wsReady, setWsReady] = useState(false);
  const wsReadyRef = useRef<boolean>(false);
  const [statusText, setStatusText] = useState<string>("");
  const wsRef = useRef<Socket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const aliyunActiveRef = useRef<boolean>(false);
  const userScrollRef = useRef<HTMLDivElement | null>(null);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);
  const aiProgressRef = useRef<number>(0);
  const startRecognitionFnRef = useRef<(() => void) | null>(null);
  const stopRecognitionFnRef = useRef<(() => void) | null>(null);
  const hangupInProgressRef = useRef<boolean>(false);
  const lastResponseAtRef = useRef<number | null>(null);
  const [sendingSoon, setSendingSoon] = useState<boolean>(false);
  const voiceHadInputRef = useRef<boolean>(false);
  const srDebounceTimerRef = useRef<number | null>(null);
  const srSendGraceTimerRef = useRef<number | null>(null);
  const lastVoiceWorkingAtRef = useRef<number>(0);
  const lastAutoSentKeyRef = useRef<string>("");
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [ttsStyle, setTtsStyle] = useState<"default" | "jarvis">("default");
  const ttsSynthRef = useRef<SpeechSynthesis | null>(null);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const currentUtterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakFnRef = useRef<(text: string) => void>(() => {});
  const progressTimerRef = useRef<number | null>(null);
  const isSilentRef = useRef<boolean>(false);

  

  const makeId = () => Math.random().toString(36).slice(2) + String(Date.now());

  const sanitizeTranscriptText = (text: string) => {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[，。！？、,.!?;:]+/g, "")
      .replace(/[，。！？、,.!?;:]+$/g, "");
  };

  const normalizeTranscriptKey = (text: string) => {
    return sanitizeTranscriptText(text).replace(/[\s，。！？、,.!?;:]+/g, "");
  };

  const mergeAliInterim = (prev: string, next: string) => {
    const pRaw = sanitizeTranscriptText(prev);
    const nRaw = sanitizeTranscriptText(next);
    const pKey = normalizeTranscriptKey(pRaw);
    const nKey = normalizeTranscriptKey(nRaw);
    if (!pKey) return nRaw;
    if (!nKey) return pRaw;
    if (nKey.startsWith(pKey) || nKey.endsWith(pKey) || nKey.includes(pKey)) return nRaw;
    if (pKey.startsWith(nKey) || pKey.endsWith(nKey) || pKey.includes(nKey)) return pRaw;
    const hasZh = /[\u4e00-\u9fff]/.test(pRaw) || /[\u4e00-\u9fff]/.test(nRaw);
    if (hasZh && nRaw.length <= 2) return (pRaw + nRaw).replace(/\s+/g, "");
    if (!hasZh && nRaw.length <= 2) return `${pRaw} ${nRaw}`.trim();
    return nRaw.length >= pRaw.length ? nRaw : pRaw;
  };

  const mergeAliFinals = (prev: string[], nextFinal: string) => {
    const nRaw = sanitizeTranscriptText(nextFinal);
    const nKey = normalizeTranscriptKey(nRaw);
    if (!nKey) return prev;

    const lastRaw = prev.length > 0 ? sanitizeTranscriptText(prev[prev.length - 1] || "") : "";
    const lastKey = normalizeTranscriptKey(lastRaw);
    if (!lastKey) return [...prev, nRaw];
    if (nKey === lastKey) return prev;
    if (nKey.startsWith(lastKey) || nKey.endsWith(lastKey) || nKey.includes(lastKey)) return [...prev.slice(0, -1), nRaw];
    if (lastKey.startsWith(nKey) || lastKey.endsWith(nKey) || lastKey.includes(nKey)) return prev;
    return [...prev, nRaw];
  };

  const composeDisplayText = (finalList: string[], im: string) => {
    const finalsText = finalList.map((x) => sanitizeTranscriptText(x)).filter(Boolean).join(" ").trim();
    const interimText = sanitizeTranscriptText(im);
    if (!finalsText) return interimText;
    if (!interimText) return finalsText;
    const finalsKey = normalizeTranscriptKey(finalsText);
    const interimKey = normalizeTranscriptKey(interimText);
    if (!interimKey) return finalsText;
    if (interimKey.length <= 2) {
      if (finalsKey.endsWith(interimKey) || finalsKey.includes(interimKey)) return finalsText;
      const hasZh = /[\u4e00-\u9fff]/.test(finalsText) || /[\u4e00-\u9fff]/.test(interimText);
      const combined = hasZh ? `${finalsText}${interimText}` : `${finalsText} ${interimText}`;
      return sanitizeTranscriptText(combined);
    }
    if (finalsKey.endsWith(interimKey) || finalsKey.includes(interimKey)) return finalsText;
    if (interimKey.startsWith(finalsKey)) return interimText;
    return `${finalsText} ${interimText}`.trim();
  };

  const latestText = composeDisplayText(finals, interim);
  const ensureSynth = () => {
    if (typeof window === "undefined") return null;
    const synth = window.speechSynthesis;
    ttsSynthRef.current = synth ?? null;
    return synth ?? null;
  };

  const pickZhVoice = (list: SpeechSynthesisVoice[]) => {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const lang = (v.lang || "").toLowerCase();
      if (lang.includes("zh")) return v;
    }
    return null;
  };

  const pickJarvisVoice = (list: SpeechSynthesisVoice[]) => {
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const lang = (v.lang || "").toLowerCase();
      if (lang.includes("en-gb")) return v;
    }
    for (let i = 0; i < list.length; i++) {
      const n = (list[i].name || "").toLowerCase();
      if (n.includes("uk") || n.includes("male") || n.includes("george") || n.includes("brian") || n.includes("ryan")) return list[i];
    }
    return list[0] ?? null;
  };

  const updateAiScrollProgress = useCallback((p: number) => {
    const el = aiScrollRef.current;
    if (!el) return;
    const sw = el.scrollWidth;
    const cw = el.clientWidth;
    const max = Math.max(0, sw - cw);
    if (max <= 0) return;

    const target = max * p;
    // 只允许前进，不允许后退
    if (target > el.scrollLeft) {
      el.scrollLeft = target;
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!ttsEnabled) return;
    const synth = ensureSynth();
    if (!synth || !text) return;
    try { synth.cancel(); } catch {}
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    
    const utt = new SpeechSynthesisUtterance(text);
    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    const voices = (ttsSynthRef.current ? ttsSynthRef.current.getVoices() : ensureSynth()?.getVoices()) || [];
    let v: SpeechSynthesisVoice | null = null;
    if (ttsStyle === "jarvis" && !hasChinese) v = pickJarvisVoice(voices);
    else v = pickZhVoice(voices);
    if (v) { utt.voice = v; utt.lang = v.lang; }
    else { utt.lang = hasChinese ? "zh-CN" : "en-GB"; }
    if (ttsStyle === "jarvis") { utt.rate = 1.02; utt.pitch = 0.9; } else { utt.rate = 1; utt.pitch = 1; }
    utt.volume = 1;

    aiProgressRef.current = 0;

    utt.onstart = () => {
      isSilentRef.current = false;
      if (!hangupInProgressRef.current && callRef.current === "active" && stopRecognitionFnRef.current) {
        const fn = stopRecognitionFnRef.current;
        window.setTimeout(() => { try { fn(); } catch {} }, 800);
      }
      // 启动估算计时器，以防 boundary 不触发
      // 更加精准的语速估算（字符/秒）: 
      // 中文通常 3.5-4.5 字/秒，英文通常 10-15 字符/秒
      const base = hasChinese ? 4.2 : 11.0; 
      const interval = 30; // 降低间隔，提高丝滑度
      progressTimerRef.current = window.setInterval(() => {
        const total = text.length || 1;
        const step = (base * utt.rate * interval) / 1000;
        // 单向递增
        aiProgressRef.current = Math.min(total, aiProgressRef.current + step);
        updateAiScrollProgress(aiProgressRef.current / total);
      }, interval);
    };

    utt.onboundary = (ev: SpeechSynthesisEvent) => {
      const idx = typeof ev?.charIndex === "number" ? ev.charIndex : 0;
      const total = text.length || 1;
      // boundary 仅用于校准，且只允许向前校准
      if (idx > aiProgressRef.current) {
        aiProgressRef.current = idx;
        updateAiScrollProgress(idx / total);
      }
    };

    utt.onend = () => {
      currentUtterRef.current = null;
      updateAiScrollProgress(0);
      aiProgressRef.current = 0;
      if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
      const mic = streamRef.current;
      const hasLiveMic = !!mic && mic.getAudioTracks().some((t) => t.readyState === "live");
      if (!hangupInProgressRef.current && hasLiveMic && callRef.current === "active" && startRecognitionFnRef.current) {
        try { startRecognitionFnRef.current(); } catch {}
      }
    };

    currentUtterRef.current = utt;
    synth.speak(utt);
  }, [ttsEnabled, ttsStyle, updateAiScrollProgress]);

  useEffect(() => { speakFnRef.current = speak; }, [speak]);

  useEffect(() => { finalsRef.current = finals; }, [finals]);

  const stopSpeak = () => {
    const mic = streamRef.current;
    const hasLiveMic = !!mic && mic.getAudioTracks().some((t) => t.readyState === "live");
    const synth = ttsSynthRef.current ?? (typeof window !== "undefined" ? window.speechSynthesis : null);
    if (synth) {
      try { synth.cancel(); } catch {}
    }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    currentUtterRef.current = null;
    updateAiScrollProgress(0);
    aiProgressRef.current = 0;

    if (!hangupInProgressRef.current && hasLiveMic && callRef.current === "active" && startRecognitionFnRef.current) {
      try { startRecognitionFnRef.current(); } catch {}
    }
  };

  const handleToggleTts = useCallback(() => {
    setTtsEnabled((prev) => {
      const next = !prev;
      if (!next) {
        try { stopSpeak(); } catch {}
      }
      return next;
    });
  }, []);

  /**
   * 通话计时器
   */
  useEffect(() => {
    if (call !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [call]);

  useEffect(() => {
    const synth = ensureSynth();
    if (synth) {
      try { synth.cancel(); } catch {}
    }
    const onUnload = () => { try { ensureSynth()?.cancel(); } catch {} };
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", onUnload);
      window.addEventListener("pagehide", onUnload);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", onUnload);
        window.removeEventListener("pagehide", onUnload);
      }
      try { ensureSynth()?.cancel(); } catch {}
    };
  }, []);

  useEffect(() => { callRef.current = call; }, [call]);

  useEffect(() => {
    if (!ttsEnabled) {
      try { stopSpeak(); } catch {}
    }
  }, [ttsEnabled]);

  /**
   * 组件挂载即建立 WS 连接，卸载时关闭
   */
  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  const resampleTo16k = (input: Float32Array, inputRate: number): Int16Array => {
    const targetRate = 16000;
    const ratio = inputRate / targetRate;
    const length = Math.floor(input.length / ratio);
    const out = new Int16Array(length);
    let i = 0;
    while (i < length) {
      const idx = Math.floor(i * ratio);
      const s = input[idx];
      const v = s < -1 ? -1 : s > 1 ? 1 : s;
      out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
      i += 1;
    }
    return out;
  };

  const ensureAliyunAudioPipeline = (s: MediaStream) => {
    const ACtor = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!ACtor) { setErr("音频上下文不可用"); return; }
    const existing = audioCtxRef.current;
    const ctx = existing && existing.state === "closed" ? new ACtor() : (existing ?? new ACtor());
    audioCtxRef.current = ctx;
    try {
      if (ctx.state === "suspended") {
        Promise.resolve(ctx.resume()).catch(() => {});
      }
    } catch {}

    try {
      const oldSrc = sourceRef.current;
      if (oldSrc) oldSrc.disconnect();
    } catch {}
    sourceRef.current = null;

    try {
      const oldProc = procRef.current;
      if (oldProc) { oldProc.disconnect(); oldProc.onaudioprocess = null; }
    } catch {}
    procRef.current = null;

    const src = ctx.createMediaStreamSource(s);
    sourceRef.current = src;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;
    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!aliyunActiveRef.current) return;
      const sk = wsRef.current;
      if (!sk || !wsReadyRef.current) return;
      const buf = e.inputBuffer.getChannelData(0);
      const pcm = resampleTo16k(buf, ctx.sampleRate);
      try { sk.emit("sr:ali:audio", pcm.buffer); } catch {}
    };
    try { src.connect(proc); } catch {}
    try { proc.connect(ctx.destination); } catch {}
  };

  const requestMicStream = (): Promise<MediaStream> => {
    if (typeof window === "undefined") return Promise.reject(new Error("not_in_browser"));
    if (!window.isSecureContext) return Promise.reject(new Error("insecure_context"));
    const nav = window.navigator;
    const md = nav.mediaDevices;
    const gum = md && typeof md.getUserMedia === "function" ? md.getUserMedia.bind(md) : null;
    if (gum) {
      return gum({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 }, sampleRate: { ideal: 16000 } } });
    }

    const legacyGum = Reflect.get(nav, "getUserMedia") ?? Reflect.get(nav, "webkitGetUserMedia") ?? Reflect.get(nav, "mozGetUserMedia");
    if (typeof legacyGum !== "function") return Promise.reject(new Error("getUserMedia_unavailable"));
    return new Promise<MediaStream>((resolve, reject) => {
      try {
        legacyGum.call(nav, { audio: true }, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  };

  const startAliyun = (ms?: MediaStream) => {
    const s = ms ?? streamRef.current;
    if (!s) { setErr("麦克风未就绪"); return; }
    ensureAliyunAudioPipeline(s);
    aliyunActiveRef.current = true;
    const sock = wsRef.current;
    if (sock && wsReadyRef.current) {
      try { sock.emit("sr:ali:start"); } catch {}
    } else {
      setErr("正在连接语音服务…");
      try { sock?.once?.("connect", () => { try { wsRef.current?.emit("sr:ali:start"); setErr(null); } catch {} }); } catch {}
    }
    setErr(null);
  };

  const stopAliyun = () => {
    const sk = wsRef.current;
    if (sk && wsReadyRef.current) { try { sk.emit("sr:ali:stop"); } catch {} }
    try {
      const p = procRef.current; const src = sourceRef.current; const ctx = audioCtxRef.current;
      if (p) { p.disconnect(); p.onaudioprocess = null; }
      if (src) { src.disconnect(); }
      if (ctx) { /* keep context for reuse */ }
    } catch {}
    procRef.current = null;
    sourceRef.current = null;
    aliyunActiveRef.current = false;
  };

  const releaseAliyunAudioContext = () => {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    try {
      if (ctx && ctx.state !== "closed") {
        Promise.resolve(ctx.close()).catch(() => {});
      }
    } catch {}
  };

  useEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    const s = io(origin, {
      path: "/api/socket",
      transports: ["websocket"],
      withCredentials: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 300,
      reconnectionDelayMax: 1500,
    });
    s.on("connect", () => {
      wsReadyRef.current = true;
      setWsReady(true);
      setStatusText("已连接");
      s.emit("start");
      s.emit("panel:join");
      console.log("[assistant] ws connect", { id: s.id, path: String(s.io?.opts?.path ?? "") });
      if (callRef.current === "active" && speechDefault === "aliyun" && !aliyunActiveRef.current) {
        try { startAliyun(); } catch {}
      }
    });
    s.on("disconnect", () => {
      wsReadyRef.current = false;
      setWsReady(false);
      setStatusText("未连接");
      console.log("[assistant] ws disconnect");
    });
    s.on("connect_error", (err: Error) => {
      wsReadyRef.current = false;
      setWsReady(false);
      setStatusText("连接错误");
      console.log("[assistant] ws connect_error", { message: err.message });
    });
    s.on("error", (err: Error) => {
      setStatusText("错误");
      console.log("[assistant] ws error", { message: err.message });
    });
    s.io.on("reconnect_attempt", (n: number) => {
      setStatusText("重连中…");
      console.log("[assistant] ws reconnect_attempt", { attempt: n });
    });
    s.on("status", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const stVal = Reflect.get(payload, "status");
      const st = typeof stVal === "string" ? stVal : "";
      const sourceVal = Reflect.get(payload, "source");
      if (st === "working" && sourceVal === "voice") {
        lastVoiceWorkingAtRef.current = Date.now();
        if (srDebounceTimerRef.current) { window.clearTimeout(srDebounceTimerRef.current); srDebounceTimerRef.current = null; }
        if (srSendGraceTimerRef.current) { window.clearTimeout(srSendGraceTimerRef.current); srSendGraceTimerRef.current = null; }
        const composed = composeDisplayText(finalsRef.current, interimRef.current);
        const key = normalizeTranscriptKey(composed);
        if (key) lastAutoSentKeyRef.current = key;
        setSendingSoon(true);
      }
      let text = "";
      if (st === "ready") text = "就绪";
      else if (st === "working") text = "处理中";
      else if (st) text = st;
      setStatusText(text);
    });
    s.on("assistant_message", (payload: { message: string }) => {
      if (payload?.message) {
        if (srDebounceTimerRef.current) { window.clearTimeout(srDebounceTimerRef.current); srDebounceTimerRef.current = null; }
        if (srSendGraceTimerRef.current) { window.clearTimeout(srSendGraceTimerRef.current); srSendGraceTimerRef.current = null; }
        setAiText(payload.message);
        try { const el = aiScrollRef.current; if (el) { el.scrollLeft = 0; } } catch {}
        aiProgressRef.current = 0;
        lastResponseAtRef.current = Date.now();
        setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: payload.message, status: "sent" }]);
        console.log("[assistant] ws assistant_message", { message: payload.message });
        setSendingSoon(false);
        voiceHadInputRef.current = false;
        try { speakFnRef.current(payload.message); } catch {}
        setFinals([]);
        setInterim("");
        interimRef.current = "";
        isSilentRef.current = false;
      }
    });
    s.on("assistant_error", (payload: { message?: string; detail?: unknown }) => {
      if (srDebounceTimerRef.current) { window.clearTimeout(srDebounceTimerRef.current); srDebounceTimerRef.current = null; }
      if (srSendGraceTimerRef.current) { window.clearTimeout(srSendGraceTimerRef.current); srSendGraceTimerRef.current = null; }
      const msg = typeof payload?.message === "string" ? payload.message : "服务错误";
      setErr(msg);
      setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: `[ERROR] ${msg}` , status: "sent" }]);
      setSendingSoon(false);
      voiceHadInputRef.current = false;
    });
    s.on("sr:ali:interim", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const tVal = Reflect.get(payload, "text");
      const t = typeof tVal === "string" ? tVal : "";
      if (!t) return;
      if (currentUtterRef.current) return;

      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("[sr:ali:interim]", { text: t, at: Date.now() });
        } catch {}
      }

      const merged = mergeAliInterim(interimRef.current, t);
      setInterim(merged);
      interimRef.current = merged;
      voiceHadInputRef.current = true;

      if (srDebounceTimerRef.current) {
        window.clearTimeout(srDebounceTimerRef.current);
        srDebounceTimerRef.current = null;
      }
      if (srSendGraceTimerRef.current) {
        window.clearTimeout(srSendGraceTimerRef.current);
        srSendGraceTimerRef.current = null;
      }
      srDebounceTimerRef.current = window.setTimeout(() => {
        srDebounceTimerRef.current = null;
        if (currentUtterRef.current) return;
        if (Date.now() - lastVoiceWorkingAtRef.current < 4000) return;
        const composed = composeDisplayText(finalsRef.current, interimRef.current);
        const finalText = sanitizeTranscriptText(composed);
        const key = normalizeTranscriptKey(finalText);
        if (!key) return;
        if (key === lastAutoSentKeyRef.current) return;
        const sock = wsRef.current;
        if (!sock || !wsReadyRef.current) return;

        setSendingSoon(true);
        srSendGraceTimerRef.current = window.setTimeout(() => {
          srSendGraceTimerRef.current = null;
          if (currentUtterRef.current) return;
          if (Date.now() - lastVoiceWorkingAtRef.current < 4000) return;
          if (!wsReadyRef.current) return;
          const s2 = wsRef.current;
          if (!s2) return;
          try {
            s2.emit("user_input", { text: finalText, source: "voice", via: "interim_gap" });
            lastAutoSentKeyRef.current = key;
          } catch {}
        }, 350);
      }, 2000);
    });
    s.on("sr:ali:final", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const tVal = Reflect.get(payload, "text");
      const t = typeof tVal === "string" ? tVal : "";
      if (!t) return;
      if (currentUtterRef.current) return;

      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("[sr:ali:final]", { text: t, at: Date.now() });
        } catch {}
      }

      setFinals((prev) => {
        const next = mergeAliFinals(prev, t);
        finalsRef.current = next;
        return next;
      });
      setInterim("");
      interimRef.current = "";
      voiceHadInputRef.current = true;
    });
    s.on("sr:ali:error", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const rawMsgVal = Reflect.get(payload, "message");
      const rawMsg = typeof rawMsgVal === "string" ? rawMsgVal : "";
      const detailVal = Reflect.get(payload, "detail");
      const detail = typeof detailVal === "object" && detailVal !== null ? detailVal : null;
      const statusTextVal = detail ? Reflect.get(detail, "statusText") : null;
      const statusText = typeof statusTextVal === "string" ? statusTextVal : "";
      const m = statusText || rawMsg || "识别错误";

      if (process.env.NODE_ENV !== "production") {
        try {
          console.log("[sr:ali:error]", { message: m, detail, at: Date.now() });
        } catch {}
      }

      setErr(m);
    });
    s.on("panel:action", (payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const idVal = Reflect.get(payload, "id");
      const id = typeof idVal === "string" ? idVal : "";
      const act = Reflect.get(payload, "action");
      if (!isPanelAction(act)) { try { s.emit("panel:done", { id, ok: false, message: "invalid action" }); } catch {} ; return; }
      try {
        const clearAck = Reflect.get(window, "panelClearAck");
        if (typeof clearAck === "function") clearAck();
      } catch {}
      try { dispatchPanelAction(act); } catch {}
      setTimeout(() => {
        let ok = true; let message: string | undefined;
        try {
          const getAck = Reflect.get(window, "panelGetAck");
          if (typeof getAck === "function") {
            const ack = getAck();
            if (typeof ack === "object" && ack !== null) {
              const okVal = Reflect.get(ack, "ok");
              const msgVal = Reflect.get(ack, "message");
              if (typeof okVal === "boolean") ok = okVal;
              if (typeof msgVal === "string") message = msgVal;
            }
          }
        } catch {}
        try { s.emit("panel:done", { id, ok, message }); } catch {}
      }, 60);
    });
    wsRef.current = s;
    return () => {
      if (srDebounceTimerRef.current) { window.clearTimeout(srDebounceTimerRef.current); srDebounceTimerRef.current = null; }
      if (srSendGraceTimerRef.current) { window.clearTimeout(srSendGraceTimerRef.current); srSendGraceTimerRef.current = null; }
      try { s.disconnect(); } catch {}
      wsRef.current = null;
      wsReadyRef.current = false;
      setWsReady(false);
    };
  }, []);

  useEffect(() => {
    const synth = ensureSynth();
    if (!synth) return;
    const assign = () => {
      const list = synth.getVoices();
      const v = ttsStyle === "jarvis" ? pickJarvisVoice(list) : pickZhVoice(list);
      ttsVoiceRef.current = v ?? null;
    };
    assign();
    const handler = () => assign();
    synth.onvoiceschanged = handler;
    return () => { synth.onvoiceschanged = null; };
  }, [ttsStyle]);

  /**
   * 格式化通话时长
   * @returns {string} 格式化后的时间字符串 (mm:ss)
   * @keyword-en formatTime, callDuration
   */
  const elapsed = useMemo(() => {
    if (!startAt) return "00:00";
    const sec = Math.floor((now - startAt) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [now, startAt]);

  /**
   * 开启语音识别服务
   * @keyword-en startRecognition, speechRecognition
   */
  

  const startRecognition = () => {
    startAliyun();
    setErr(null);
  };

  /**
   * 停止语音识别服务
   * @keyword-en stopRecognition, endSpeech
   */
  const stopRecognition = () => {
    setSendingSoon(false);
    voiceHadInputRef.current = false;
    isSilentRef.current = false;
    if (srDebounceTimerRef.current) { window.clearTimeout(srDebounceTimerRef.current); srDebounceTimerRef.current = null; }
    if (srSendGraceTimerRef.current) { window.clearTimeout(srSendGraceTimerRef.current); srSendGraceTimerRef.current = null; }
    console.log("[assistant] stopRecognition");
    try { stopAliyun(); } catch {}
  };

  useEffect(() => {
    startRecognitionFnRef.current = startRecognition;
    stopRecognitionFnRef.current = stopRecognition;
  }, [startRecognition, stopRecognition]);


  return (
    <div className="assistant-panel flex flex-col h-full gap-4">
      {/* 智能助手面板区域开始 */}
      <div className="assistant-panel__header flex items-center justify-between shrink-0">
        <div className="font-medium text-zinc-400 text-[clamp(12px,1.2vw,14px)]">交互模式</div>
        <div className="flex items-center p-1 bg-white/5 rounded-full ring-1 ring-white/10">
          <button
            className={`rounded-full px-4 py-1.5 font-medium transition-all duration-300 text-[clamp(11px,1.1vw,13px)] ${
              mode === "voice"
                ? "bg-cyan-500 text-white shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setMode("voice")}
          >
            语音助手
          </button>
          <button
            className={`rounded-full px-4 py-1.5 font-medium transition-all duration-300 text-[clamp(11px,1.1vw,13px)] ${
              mode === "chat"
                ? "bg-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setMode("chat")}
          >
            文字聊天
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <span className={`rounded-full px-2 py-1 text-[10px] ring-1 ${wsReady ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" : "bg-white/5 text-zinc-400 ring-white/10"}`}>{wsReady ? "WS已连接" : "WS未连接"}</span>
        {statusText ? (
          <span className="rounded-full px-2 py-1 text-[10px] bg-white/5 text-zinc-400 ring-1 ring-white/10">{statusText}</span>
        ) : null}
        {sendingSoon ? (
          <span className="rounded-full px-2 py-1 text-[10px] bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">发送中…</span>
        ) : null}
        {err ? (
          <span className="rounded-full px-2 py-1 text-[10px] bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30">{err}</span>
        ) : null}
      </div>

      {mode === "voice" ? (
        <div className="assistant-panel__voice flex-1 flex flex-col min-h-0">
          {/* 语音助手区域开始 */}
          <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
            <div className="font-semibold tracking-wide text-zinc-200 mb-1 text-[clamp(12px,1.2vw,14px)]">
              {call === "active" ? "正在聆听指令" : "语音助手待命"}
            </div>
            <div className="font-mono text-cyan-400/80 uppercase tracking-widest mb-6 text-[clamp(10px,1vw,12px)]">
              {call === "active" ? `IN CALL · ${elapsed}` : "READY TO START"}
            </div>

            <div className="assistant-panel__hint max-w-[80%] rounded-xl bg-cyan-500/5 p-3 ring-1 ring-cyan-500/10 text-zinc-500 text-center leading-relaxed mb-4 text-[clamp(10px,1vw,12px)]">
              {call === "active" 
                ? "您可以尝试说：“展示 A 区客流分析” 或 “对比昨日营收数据”" 
                : "点击右下方按钮，开启智能语音助手，为您提供实时数据分析支持"}
            </div>

            {/* 用户已发送文本（单行横向滚动） */}
            <div ref={userScrollRef} className="assistant-panel__transcript text-center min-h-[1.8em] text-[clamp(12px,1.2vw,14px)] whitespace-nowrap overflow-x-auto no-scrollbar px-2" style={{ transition: "all 300ms ease", opacity: latestText ? 1 : 0 }}>
              {latestText && (
                <span key={latestText} className="text-zinc-300 font-medium">
                  {latestText}
                </span>
              )}
            </div>

            {/* AI 朗读文本（随朗读进度自动向右滚动显示内容） */}
            <div className="w-full overflow-hidden mt-2 px-2">
              <div ref={aiScrollRef} className="assistant-panel__ai text-left text-[clamp(12px,1.2vw,14px)] whitespace-nowrap overflow-x-auto no-scrollbar min-h-[1.8em]">
                <span className="text-cyan-300 font-medium inline-block">{aiText}</span>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-4 border-t border-white/5">
            {/* 底部控制与能量柱区域开始 */}
            <div className="flex items-center gap-4 bg-black/40 rounded-2xl p-3 ring-1 ring-white/5">
              <div className="flex-1 flex items-center justify-center h-[clamp(36px,3.6vw,52px)]">
                <VoiceMeter active={call === "active"} stream={stream} denoise={true} sendingSoon={sendingSoon} />
              </div>

              <button
                className={"mt-[10px] group relative flex items-center justify-center rounded-xl w-[clamp(36px,3.8vw,48px)] h-[clamp(36px,3.8vw,48px)] transition-all " + (ttsEnabled ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500 hover:text-white" : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200")}
                onClick={handleToggleTts}
                aria-label="切换TTS朗读"
              >
                <svg className="fill-none stroke-current w-[clamp(20px,2.2vw,24px)] h-[clamp(20px,2.2vw,24px)]" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5l6 4v6l-6 4V5zM7 10H5v4h2v-4z" />
                </svg>
              </button>

              <button
                className={"mt-[10px] group relative flex items-center justify-center rounded-xl w-[clamp(36px,3.8vw,48px)] h-[clamp(36px,3.8vw,48px)] transition-all " + (ttsStyle === "jarvis" ? "bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/30 hover:bg-indigo-500 hover:text-white" : "bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200")}
                onClick={() => setTtsStyle((v) => (v === "jarvis" ? "default" : "jarvis"))}
                aria-label="切换Jarvis音色"
                title="Jarvis音色"
              >
                <svg className="fill-none stroke-current w-[clamp(20px,2.2vw,24px)] h-[clamp(20px,2.2vw,24px)]" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l4 4-4 4-4-4 4-4zm0 10l7 7H5l7-7z" />
                </svg>
              </button>

              {call === "active" ? (
                <button
                  className="mt-[10px] group relative flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/30 transition-all hover:bg-rose-500 hover:text-white w-[clamp(36px,3.8vw,48px)] h-[clamp(36px,3.8vw,48px)]"
                  onClick={() => {
                    hangupInProgressRef.current = true;
                    setCall("idle");
                    setStartAt(null);
                    if (stream) {
                      stream.getTracks().forEach((t) => t.stop());
                      setStream(null);
                    }
                    setFinals([]);
                    setInterim("");
                    interimRef.current = "";
                    stopRecognition();
                    stopSpeak();
                    releaseAliyunAudioContext();
                    isSilentRef.current = false;
                    lastResponseAtRef.current = null;
                    setSendingSoon(false);
                    voiceHadInputRef.current = false;
                    hangupInProgressRef.current = false;
                  }}
                >
                  <svg className="fill-none stroke-current w-[clamp(18px,2vw,22px)] h-[clamp(18px,2vw,22px)]" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <button
                  className="mt-[10px] group relative flex items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/30 transition-all hover:bg-cyan-500 hover:text-white hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] active:scale-95 w-[clamp(36px,3.8vw,48px)] h-[clamp(36px,3.8vw,48px)]"
                  onClick={() => {
                    requestMicStream()
                      .then((s) => {
                        setStream(s);
                        setCall("active");
                        setStartAt(Date.now());
                        setErr(null);
                        setFinals([]);
                        setInterim("");
                        interimRef.current = "";
                        ensureAliyunAudioPipeline(s);
                        startAliyun(s);
                        if (aiText) setAiText("");
                        isSilentRef.current = false;
                        setSendingSoon(false);
                        voiceHadInputRef.current = false;
                        lastResponseAtRef.current = null;
                      })
                      .catch((e: unknown) => {
                        const msg = e instanceof Error ? e.message : String(e || "");
                        if (msg === "insecure_context") setErr("需要HTTPS或localhost才能使用麦克风");
                        else if (msg === "getUserMedia_unavailable") setErr("当前环境不支持麦克风采集");
                        else setErr("麦克风不可用或被拒绝");
                      });
                  }}
                >
                  <svg className="fill-none stroke-current w-[clamp(20px,2.2vw,24px)] h-[clamp(20px,2.2vw,24px)]" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
              )}
            </div>
            {/* 底部控制与能量柱区域结束 */}
            {err && <div className="mt-2 text-center text-[10px] text-rose-400 animate-pulse">{err}</div>}
          </div>
          {/* 语音助手区域结束 */}
        </div>
      ) : (
        <div className="assistant-panel__chat flex-1 min-h-0 grid grid-rows-[1fr_auto] gap-4">
          <div className="assistant-panel__messages space-y-4 min-h-0 overflow-y-auto no-scrollbar">
            {messages.map((m) => (
              m.role === "assistant" ? (
                <div key={m.id} className="flex flex-col gap-1.5 items-start">
                  <div className="text-[10px] font-medium text-cyan-400/70 ml-1">AI ASSISTANT</div>
                  <div className="rounded-2xl rounded-tl-none bg-white/5 p-3 ring-1 ring-white/10 text-sm text-zinc-200 max-w-[90%]">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col gap-1.5 items-end">
                  <div className="text-[10px] font-medium text-violet-400/70 mr-1">OPERATOR</div>
                  <div className={"rounded-2xl rounded-tr-none p-3 ring-1 text-sm max-w-[90%] " + (m.status === "pending" ? "bg-violet-500/10 ring-violet-500/30 text-zinc-300 animate-pulse" : "bg-violet-500/10 ring-violet-500/20 text-zinc-200")}>{m.text}{m.status === "pending" ? "（发送中…）" : ""}</div>
                </div>
              )
            ))}
          </div>

          <div className="assistant-panel__input-group flex gap-2 pt-2 border-t border-white/5">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 rounded-xl bg-black/40 px-4 py-2.5 text-sm ring-1 ring-white/10 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 transition-all"
              placeholder="输入查询指令…"
            />
            <button
              className="flex items-center justify-center size-10 rounded-xl bg-linear-to-tr from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/20 hover:scale-105 transition-transform"
              onClick={() => {
                const text = inputText.trim();
                if (!text) return;
                setMessages((prev) => [...prev, { id: makeId(), role: "user", text, status: "sent" }]);
                setInputText("");
                const s = wsRef.current;
                if (s && wsReady) {
                  try { s.emit("user_input", { text }); } catch {}
                }
              }}
            >
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          {/* 文字聊天区域结束 */}
        </div>
      )}
      {/* 智能助手面板区域结束 */}
    </div>
  );

}
