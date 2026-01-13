"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import VoiceMeter from "./VoiceMeter";
import { dispatchPanelAction, isPanelAction } from "./panelBus";

type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SRResultList = ArrayLike<SRResult>;
interface SRLikeEvent { resultIndex: number; results: SRResultList }
interface SpeechRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SRLikeEvent) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: ((e: unknown) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
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
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recogRef = useRef<SpeechRecognition | null>(null);
  const [interim, setInterim] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const interimRef = useRef<string>("");
  const finalsRef = useRef<string[]>([]);
  type Msg = { id: string; role: "assistant" | "user"; text: string; status: "pending" | "sent" };
  const [messages, setMessages] = useState<Msg[]>([]);
  const [inputText, setInputText] = useState<string>("");

  /**
   * 获取最新的识别文本
   * @keyword-en latestText, speechToText
   */
  const latestText = useMemo(() => {
    const im = interim.trim();
    if (im.length > 0) return im;
    if (finals.length > 0) return finals[finals.length - 1];
    return "";
  }, [interim, finals]);

  const [aiText, setAiText] = useState("");
  const [wsReady, setWsReady] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const wsRef = useRef<Socket | null>(null);
  const userScrollRef = useRef<HTMLDivElement | null>(null);
  const aiScrollRef = useRef<HTMLDivElement | null>(null);
  const aiProgressRef = useRef<number>(0);
  const startRecognitionFnRef = useRef<(() => void) | null>(null);
  const stopRecognitionFnRef = useRef<(() => void) | null>(null);
  const lastResponseAtRef = useRef<number | null>(null);
  const awaitingRef = useRef<boolean>(false);
  const [sendingSoon, setSendingSoon] = useState<boolean>(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [ttsStyle, setTtsStyle] = useState<"default" | "jarvis">("default");
  const ttsSynthRef = useRef<SpeechSynthesis | null>(null);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const currentUtterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakFnRef = useRef<(text: string) => void>(() => {});
  const progressTimerRef = useRef<number | null>(null);
  const isSilentRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<number | null>(null);
  const pendingAccumulateRef = useRef<string>("");
  const pendingMessageIdRef = useRef<string | null>(null);
  const pendingTextRef = useRef<string>("");
  const sendIntentRef = useRef<boolean>(false);
  const voiceFramesRef = useRef<number>(0);
  const silenceFramesRef = useRef<number>(0);
  const SILENCE_GATE = Number(process.env.NEXT_PUBLIC_SILENCE_GATE ?? "0.06");
  const VOICE_FRAMES_MIN = Number(process.env.NEXT_PUBLIC_VOICE_FRAMES_MIN ?? "4");
  const SILENCE_FRAMES_MIN = Number(process.env.NEXT_PUBLIC_SILENCE_FRAMES_MIN ?? "4");

  

  const makeId = () => Math.random().toString(36).slice(2) + String(Date.now());
  const composeText = () => `${pendingAccumulateRef.current} ${finals.join(" ")} ${interimRef.current}`.trim();
  const upsertPending = (text: string) => {
    if (!text) { console.log("[assistant] upsertPending: empty text, skip"); return; }
    pendingTextRef.current = text;
    setMessages((prev) => {
      console.log('开始修改了',prev.length,prev);
      const pid = pendingMessageIdRef.current;
      if (pid) {
        const exists = prev.some((m) => m.id === pid);
        console.log("[assistant "+pid+"] upsertPending: update", { id: pid, text, prevLen: prev.length, exists });
        if (!exists) return [...prev, { id: pid, role: "user", text, status: "pending" }];
        return prev.map((m) => (m.id === pid ? { ...m, text } : m));
      }
      const nid = makeId();
      pendingMessageIdRef.current = nid;
      console.log("[assistant] upsertPending: create", { id: nid, text });
      console.log([...prev, { id: nid, role: "user", text, status: "pending" }]);
      return [...prev, { id: nid, role: "user", text, status: "pending" }];
    });
  };
  const markPendingSent = () => {
    const pid = pendingMessageIdRef.current;
    if (!pid) return;
    console.log("[assistant] markPendingSent", { id: pid });
    setMessages((prev) => prev.map((m) => (m.id === pid ? { ...m, status: "sent" } : m)));
    pendingMessageIdRef.current = null;
  };

  const scheduleSend = () => {
    const composed = composeText();
    if (!composed) return;
    upsertPending(composed);
    if (isSilentRef.current) {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      setSendingSoon(true);
      silenceTimerRef.current = window.setTimeout(() => {
        silenceTimerRef.current = null;
        const s = wsRef.current;
        if (s && wsReady) {
          try { s.emit("user_input", { text: composed }); console.log("[assistant] debounced-send", { text: composed }); } catch {}
          awaitingRef.current = true;
        } else {
          console.log("[assistant] debounced-send skip: ws not ready");
        }
        setSendingSoon(false);
        sendIntentRef.current = false;
      }, 3000);
    } else {
      sendIntentRef.current = true;
    }
  };

  const sendNow = (text: string) => {
    const payload = String(text || "").trim();
    if (!payload) return;
    upsertPending(payload);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setSendingSoon(false);
    const s = wsRef.current;
    if (s && wsReady) {
      try { s.emit("user_input", { text: payload }); console.log("[assistant] sendNow", { text: payload }); } catch {}
      awaitingRef.current = true;
    } else {
      console.log("[assistant] sendNow skip: ws not ready");
    }
  };

  // 直接使用 latestText 展示，去除副作用更新以满足 lint 规则

  

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
      if (stopRecognitionFnRef.current) {
        try { stopRecognitionFnRef.current(); } catch {}
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
      if (startRecognitionFnRef.current && call === "active") {
        try { startRecognitionFnRef.current(); } catch {}
      }
    };

    currentUtterRef.current = utt;
    synth.speak(utt);
  }, [ttsEnabled, ttsStyle, call, updateAiScrollProgress]);

  useEffect(() => { speakFnRef.current = speak; }, [speak]);

  useEffect(() => { finalsRef.current = finals; }, [finals]);

  const stopSpeak = () => {
    const synth = ttsSynthRef.current ?? (typeof window !== "undefined" ? window.speechSynthesis : null);
    if (synth) {
      try { synth.cancel(); } catch {}
    }
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    currentUtterRef.current = null;
    updateAiScrollProgress(0);
    aiProgressRef.current = 0;
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

  useEffect(() => {
    if (!ttsEnabled) {
      try { stopSpeak(); } catch {}
    }
  }, [ttsEnabled]);

  /**
   * 组件挂载即建立 WS 连接，卸载时关闭
   */
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
      setWsReady(true);
      setStatusText("已连接");
      s.emit("start");
      s.emit("panel:join");
      console.log("[assistant] ws connect", { id: s.id, path: String(s.io?.opts?.path ?? "") });
    });
    s.on("disconnect", () => {
      setWsReady(false);
      setStatusText("未连接");
    });
    s.on("connect_error", (err: Error) => {
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
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const st = obj && typeof obj.status === "string" ? obj.status : "";
      let text = "";
      if (st === "ready") text = "就绪";
      else if (st === "working") text = "处理中";
      else if (st) text = st;
      setStatusText(text);
    });
    s.on("assistant_message", (payload: { message: string }) => {
      if (payload?.message) {
        const composedBeforeReset = `${pendingAccumulateRef.current} ${finalsRef.current.join(" ")} ${interimRef.current}`.trim();
        if (pendingMessageIdRef.current) { markPendingSent(); }
        setAiText(payload.message);
        try { const el = aiScrollRef.current; if (el) { el.scrollLeft = 0; } } catch {}
        aiProgressRef.current = 0;
        lastResponseAtRef.current = Date.now();
        awaitingRef.current = false;
        setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: payload.message, status: "sent" }]);
        console.log("[assistant] ws assistant_message", { message: payload.message });
        setSendingSoon(false);
        try { speakFnRef.current(payload.message); } catch {}
        setFinals([]);
        setInterim("");
        interimRef.current = "";
        pendingAccumulateRef.current = "";
        pendingTextRef.current = "";
        isSilentRef.current = false;
        voiceFramesRef.current = 0;
        silenceFramesRef.current = 0;
        sendIntentRef.current = false;
      }
    });
    s.on("assistant_error", (payload: { message?: string; detail?: unknown }) => {
      const msg = typeof payload?.message === "string" ? payload.message : "服务错误";
      setErr(msg);
      markPendingSent();
      setMessages((prev) => [...prev, { id: makeId(), role: "assistant", text: `[ERROR] ${msg}` , status: "sent" }]);
      setSendingSoon(false);
      awaitingRef.current = false;
    });
    s.on("panel:action", (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const id = typeof p.id === "string" ? p.id : "";
      const act = p.action as unknown;
      if (!isPanelAction(act)) { try { s.emit("panel:done", { id, ok: false, message: "invalid action" }); } catch {} ; return; }
      try { (window as unknown as { panelClearAck?: () => void }).panelClearAck?.(); } catch {}
      try { dispatchPanelAction(act); } catch {}
      setTimeout(() => {
        let ok = true; let message: string | undefined;
        try {
          const ack = (window as unknown as { panelGetAck?: () => { ok: boolean; message?: string } | null }).panelGetAck?.();
          if (ack) { ok = ack.ok; message = ack.message; }
        } catch {}
        try { s.emit("panel:done", { id, ok, message }); } catch {}
      }, 60);
    });
    s.on("disconnect", () => { setWsReady(false); console.log("[assistant] ws disconnect"); });
    wsRef.current = s;
    return () => {
      try { s.disconnect(); } catch {}
      wsRef.current = null;
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
 * 根据音量阈值进行 2s 静默判定并发送文本
 * - 静默开始：启动 2s 计时器
 * - 计时期间若再次说话：取消发送；如已收到回复则中断并重连；如未发送则累积文本
 * @keyword-en rmsGate, silenceTimeout, reconnectOnInterrupt
 */
  const handleRms = (rms: number) => {
    const speaking = !!currentUtterRef.current;
    if (speaking) return;
    if (rms >= SILENCE_GATE) {
      voiceFramesRef.current += 1;
      silenceFramesRef.current = 0;
      if (voiceFramesRef.current >= VOICE_FRAMES_MIN) {
        if (isSilentRef.current) isSilentRef.current = false;
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        setSendingSoon(false);
      }
    } else {
      silenceFramesRef.current += 1;
      voiceFramesRef.current = 0;
      if (silenceFramesRef.current >= SILENCE_FRAMES_MIN) {
        if (!isSilentRef.current) {
          isSilentRef.current = true;
          const txt = composeText();
          if (txt) scheduleSend();
          else if (sendIntentRef.current) scheduleSend();
        }
      }
    }
  };

  /**
   * 开启语音识别服务
   * @keyword-en startRecognition, speechRecognition
   */
  

  const getSpeechRecognitionCtor = (): (new () => SpeechRecognition) | null => {
    if (typeof window === "undefined") return null;
    if (typeof window.SpeechRecognition === "function") return window.SpeechRecognition;
    if (typeof window.webkitSpeechRecognition === "function") return window.webkitSpeechRecognition;
    return null;
  };

  const startRecognition = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setErr("浏览器不支持语音识别");
      return;
    }
    const r = new Ctor();
    r.lang = "zh-CN";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e: SRLikeEvent) => {
      if (currentUtterRef.current) return;
      let f = "";
      let im = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) f += t;
        else im += t;
      }
      if (f) setFinals((prev) => [...prev, f]);
      setInterim(im);
      interimRef.current = im;
      const nextText = `${pendingAccumulateRef.current} ${[...finals, f].join(" ")} ${im}`.trim();
      if (nextText) {
        if (f) {
          console.log('sendNow');
          sendNow(nextText);
        } else {
          upsertPending(nextText);
          scheduleSend();
        }
      }
      console.log("[assistant] onresult", { final: f, interim: im });
    };
    r.onerror = () => {};
    r.onend = () => {
      if (recogRef.current) r.start();
    };
    recogRef.current = r;
    console.log("[assistant] startRecognition");
    r.start();
    setErr(null);
  };

  /**
   * 停止语音识别服务
   * @keyword-en stopRecognition, endSpeech
   */
  const stopRecognition = () => {
    const r = recogRef.current;
    if (r) {
      try { r.onend = null; r.stop(); } catch {}
    }
    recogRef.current = null;
    setInterim("");
    interimRef.current = "";
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    isSilentRef.current = false;
    pendingAccumulateRef.current = "";
    const pid = pendingMessageIdRef.current;
    if (pid) {
      pendingMessageIdRef.current = null;
    }
    pendingTextRef.current = "";
    voiceFramesRef.current = 0;
    silenceFramesRef.current = 0;
    console.log("[assistant] stopRecognition");
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
          <span className="rounded-full px-2 py-1 text-[10px] bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">即将发送</span>
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
                <VoiceMeter active={call === "active"} stream={stream} denoise={true} onRms={handleRms} sendingSoon={sendingSoon} />
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
                    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                    isSilentRef.current = false;
                    awaitingRef.current = false;
                    pendingAccumulateRef.current = "";
                    lastResponseAtRef.current = null;
                    sendIntentRef.current = false;
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
                    navigator.mediaDevices
                      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } } })
                      .then((s) => {
                        setStream(s);
                        setCall("active");
                        setStartAt(Date.now());
                        setErr(null);
                        setFinals([]);
                        setInterim("");
                        interimRef.current = "";
                        startRecognition();
                        if (aiText) setAiText("");
                        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                        isSilentRef.current = false;
                        awaitingRef.current = false;
                        pendingAccumulateRef.current = "";
                        lastResponseAtRef.current = null;
                      })
                      .catch(() => {
                        setErr("麦克风不可用或被拒绝");
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
