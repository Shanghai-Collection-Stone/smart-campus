"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const BAR_COUNT = 10;

/**
 * 语音能量柱组件
 * @param {boolean} active 是否激活，决定是否渲染与采样
 * @param {MediaStream|null} stream 音频输入流，来自麦克风
 * @param {boolean} denoise 是否启用基础降噪滤波链
 * @param {(rms:number)=>void} onRms RMS 音量回调，用于外部静默判定
 * @returns {JSX.Element} 音量可视化组件
 * @keyword-en VoiceMeter, audioVisualizer, rmsMeter, micEnergy
 */
export default function VoiceMeter({ active = false, stream, denoise = true, onRms, sendingSoon = false }: { active?: boolean; stream?: MediaStream | null; denoise?: boolean; onRms?: (rms: number) => void; sendingSoon?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.querySelectorAll<HTMLDivElement>("[data-bar]"));
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (!active || !stream) {
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
        analyserRef.current = null;
      }
      bars.forEach((bar) => {
        bar.style.height = `8px`;
        bar.style.opacity = `0.3`;
      });
      return;
    }

    const AudioContextCtor = typeof window.AudioContext === "function"
      ? window.AudioContext
      : (typeof window.webkitAudioContext === "function" ? window.webkitAudioContext : AudioContext);
    const ctx = new AudioContextCtor();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    if (denoise) {
      const notch = ctx.createBiquadFilter();
      notch.type = "notch";
      notch.frequency.value = 50;
      notch.Q.value = 10;

      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 120;
      high.Q.value = 0.7;

      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 7000;
      low.Q.value = 0.7;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 26;
      comp.ratio.value = 3;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      source.connect(notch);
      notch.connect(high);
      high.connect(low);
      low.connect(comp);
      comp.connect(analyser);
    } else {
      source.connect(analyser);
    }
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const animate = () => {
      if (sendingSoon) {
        const t = performance.now() / 360;
        for (let i = 0; i < BAR_COUNT; i++) {
          const phase = t + i * 0.4;
          const wave = Math.abs(Math.sin(phase));
          const h = 14 + 26 * wave;
          const bar = bars[i];
          bar.style.height = `${h}px`;
          bar.style.opacity = `${0.7 + 0.25 * wave}`;
        }
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      analyser.getByteTimeDomainData(time);
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / time.length);
      if (onRms) {
        try { onRms(rms); } catch {}
      }

      analyser.getByteFrequencyData(data);
      const group = Math.max(1, Math.floor(data.length / BAR_COUNT));
      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        const start = i * group;
        const end = Math.min(data.length, start + group);
        for (let j = start; j < end; j++) sum += data[j];
        const avg = sum / (end - start || 1);
        const n = avg / 255;
        const silenceGate = 0.04;
        const h = rms < silenceGate ? 10 : 12 + n * 44;
        const bar = bars[i];
        bar.style.height = `${h}px`;
        bar.style.opacity = `${rms < silenceGate ? 0.35 : 0.5 + n * 0.5}`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
        analyserRef.current = null;
      }
    };
  }, [active, stream, denoise, onRms, sendingSoon]);

  return (
    <div ref={ref} className="flex items-end justify-center gap-1" style={{ height: 56, overflow: "hidden" }}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          data-bar
          className="w-2 rounded-full bg-linear-to-b from-cyan-400/70 to-violet-500/70 shadow-[0_0_14px_rgba(56,189,248,0.3)]"
          style={{
            height: 8,
            transition: "height 80ms linear, opacity 120ms linear",
          }}
        />
      ))}
    </div>
  );
}
