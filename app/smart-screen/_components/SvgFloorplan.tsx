"use client";

import { useEffect, useRef, useState, useMemo } from "react";

declare global {
  interface Window {
    svgGatherTopRight?: (count?: number) => void;
  }
}

type Agent = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  moving: boolean;
  tx: number;
  ty: number;
  speed: number;
  flickerUntil: number;
  jitterUntil: number;
};

export default function SvgFloorplan() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // const [svgImage, setSvgImage] = useState<HTMLImageElement | null>(null);
  const [viewBox, setViewBox] = useState("0 0 100 100");
  const agentsRef = useRef<Agent[]>([]);
  const rafRef = useRef<number | null>(null);
  const spriteIdleRef = useRef<HTMLCanvasElement[]>([]);
  const spriteMovingRef = useRef<HTMLCanvasElement[]>([]);
  const perfStateRef = useRef({ busyAvg: 0, frameAvg: 0, fps: 0, longTasks: 0 });
  const [perfUI, setPerfUI] = useState({ busyPct: 0, fps: 0, longTasks: 0 });
  const longObsRef = useRef<PerformanceObserver | null>(null);

  // 加载 SVG 并转为 Image 对象
  useEffect(() => {
    fetch("/topoexport_2D_vectorial.svg")
      .then((res) => res.text())
      .then((text) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "image/svg+xml");
        const svgEl = doc.querySelector("svg");
        
        if (svgEl) {
           const vb = svgEl.getAttribute("viewBox") || "0 0 4096 4096";
           setViewBox(vb);
         }
      });
  }, []);

  useEffect(() => {
    try {
      const obs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        let c = 0;
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].entryType === "longtask") c++;
        }
        perfStateRef.current.longTasks += c;
      });
      obs.observe({ entryTypes: ["longtask"] });
      longObsRef.current = obs;
    } catch {}
    return () => {
      try { longObsRef.current?.disconnect(); } catch {}
      longObsRef.current = null;
    };
  }, []);

  // 初始化人群（基于 viewBox 全域均匀分布，带最小间距）
  useEffect(() => {
    const [minX, minY, width, height] = viewBox.split(" ").map(Number);
    const boundX = minX + 800;
    const boundY = minY + 800;
    const boundW = (width || 4096) - 1600;
    const boundH = (height || 4096) - 1600;

    const count = 300;
    const minDist = 28;
    const minDist2 = minDist * minDist;
    const agents: Agent[] = [];

    for (let i = 0; i < count; i++) {
      let x = 0, y = 0;
      let ok = false;
      for (let t = 0; t < 1000; t++) {
        x = boundX + Math.random() * boundW;
        y = boundY + Math.random() * boundH;
        let pass = true;
        const isTopRight = x > boundX + boundW * 0.75 && y < boundY + boundH * 0.25;
        if (isTopRight && Math.random() < 0.7) { pass = false; }
        if (pass) {
          for (let j = 0; j < agents.length; j++) {
            const dx = x - agents[j].x;
            const dy = y - agents[j].y;
            if (dx * dx + dy * dy < minDist2) { pass = false; break; }
          }
        }
        if (pass) { ok = true; break; }
      }
      if (!ok) {
        x = boundX + Math.random() * boundW;
        y = boundY + Math.random() * boundH;
      }
      agents.push({
        id: i,
        x,
        y,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
        moving: false,
        tx: x,
        ty: y,
        speed: 0.5 + (Math.random() - 0.5) * 0.2,
        flickerUntil: 0,
        jitterUntil: 0,
      });
    }
    agentsRef.current = agents;
  }, [viewBox]);

  // Canvas 动画循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 解析 viewBox
    const [minX, minY, width, height] = viewBox.split(" ").map(Number);
    let scaleX = 1;
    let scaleY = 1;
    const setCanvasSize = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      const wCss = Math.max(1, rect.width);
      const hCss = Math.max(1, rect.height);
      canvas.width = Math.round(wCss * dpr);
      canvas.height = Math.round(hCss * dpr);
      scaleX = canvas.width / (width || 4096);
      scaleY = canvas.height / (height || 4096);
    };
    setCanvasSize();
    window.addEventListener("resize", setCanvasSize);

    const SPRITE_WORLD_SIZE = 84;
    const SPRITE_FRAMES = 16;
    const buildFrames = (moving: boolean) => {
      const frames: HTMLCanvasElement[] = [];
      for (let i = 0; i < SPRITE_FRAMES; i++) {
        const p = i / (SPRITE_FRAMES - 1);
        const pulse = p;
        const outerR = 36 * pulse;
        const haloR = moving ? 20 : 16;
        const haloA = moving ? 0.5 : 0.4;
        const coreR = moving ? 8 : 6;
        const outerA = (moving ? 0.22 : 0.18) * (1 - pulse);
        const c = document.createElement("canvas");
        const px = Math.max(32, Math.round(SPRITE_WORLD_SIZE));
        c.width = px;
        c.height = px;
        const g = c.getContext("2d");
        if (!g) { frames.push(c); continue; }
        const ratio = px / SPRITE_WORLD_SIZE;
        const cx = px / 2;
        const cy = px / 2;
        g.beginPath();
        g.arc(cx, cy, outerR * ratio, 0, Math.PI * 2);
        g.fillStyle = `rgba(16,185,129,${outerA})`;
        g.fill();
        g.beginPath();
        g.arc(cx, cy, haloR * ratio, 0, Math.PI * 2);
        g.fillStyle = `rgba(52,211,153,${haloA})`;
        g.fill();
        g.beginPath();
        g.arc(cx, cy, coreR * ratio, 0, Math.PI * 2);
        g.fillStyle = "#34d399";
        g.fill();
        frames.push(c);
      }
      return frames;
    };
    spriteIdleRef.current = buildFrames(false);
    spriteMovingRef.current = buildFrames(true);

    // 获取实际渲染范围，用于反弹边界检测
    // 这里简单使用 viewBox 的边界，假设建筑位于中心区域
    // 假设 SVG 坐标系是 0-4096，我们稍微缩小活动范围，避免贴边
    const boundX = minX + 800;
    const boundY = minY + 800;
    const boundW = (width || 4096) - 1600;
    const boundH = (height || 4096) - 1600;

    const gatherCenterX = boundX + boundW * 0.85;
    const gatherCenterY = boundY + boundH * 0.08;

    window.svgGatherTopRight = (count?: number) => {
      const idleIdxs = agentsRef.current
        .map((a, i) => (!a.moving ? i : -1))
        .filter((i) => i !== -1);
      const take = Math.min(typeof count === "number" && count > 0 ? count : 120, idleIdxs.length);
      for (let k = 0; k < take && idleIdxs.length > 0; k++) {
        const pick = Math.floor(Math.random() * idleIdxs.length);
        const idx = idleIdxs.splice(pick, 1)[0];
        const a = agentsRef.current[idx];
        const dx = (Math.random() - 0.5) * 260;
        const dy = (Math.random() - 0.5) * 120;
        const tx = gatherCenterX + dx;
        const ty = gatherCenterY + dy;
        a.tx = Math.max(boundX, Math.min(boundX + boundW, tx));
        a.ty = Math.max(boundY, Math.min(boundY + boundH, ty));
        const s = 0.95 + (Math.random() - 0.5) * 0.3;
        a.speed = s > 0.2 ? s : 0.2;
        a.moving = true;
      }
    };

    const movingTarget = 30;
    const moveTimer = window.setInterval(() => {
      let movingCount = 0;
      for (let i = 0; i < agentsRef.current.length; i++) {
        if (agentsRef.current[i].moving) movingCount++;
      }
      const need = Math.max(0, movingTarget - movingCount);
      if (need === 0) return;
      const idleIdxs = agentsRef.current
        .map((a, i) => (!a.moving ? i : -1))
        .filter((i) => i !== -1);
      for (let k = 0; k < need && idleIdxs.length > 0; k++) {
        const pick = Math.floor(Math.random() * idleIdxs.length);
        const idx = idleIdxs.splice(pick, 1)[0];
        const a = agentsRef.current[idx];
        const ang = Math.random() * Math.PI * 2;
        const step = 400 + Math.random() * 900;
        const tx = a.x + Math.cos(ang) * step;
        const ty = a.y + Math.sin(ang) * step;
        a.tx = Math.max(boundX, Math.min(boundX + boundW, tx));
        a.ty = Math.max(boundY, Math.min(boundY + boundH, ty));
        a.speed = 0.8 + (Math.random() - 0.5) * 0.2;
        a.moving = true;
      }
    }, 1000);

    const jitterIntervalMs = 3000;
    const jitterTimer = window.setInterval(() => {
      const now = performance.now();
      const jitterCount = Math.max(50, Math.floor(50 + Math.random() * 50));
      const idleIdxs = agentsRef.current
        .map((a, i) => (!a.moving ? i : -1))
        .filter((i) => i !== -1);
      for (let i = 0; i < jitterCount && idleIdxs.length > 0; i++) {
        const pick = Math.floor(Math.random() * idleIdxs.length);
        const idx = idleIdxs.splice(pick, 1)[0];
        const a = agentsRef.current[idx];
        a.jitterUntil = now + 1500;
      }
    }, jitterIntervalMs);

    const frameInterval = 1000 / 30;
    let lastTs = 0;
    let lastUiAt = 0;
    let prevFrameTs = 0;
    const draw = () => {
      const ts = performance.now();
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      if (ts - lastTs < frameInterval) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastTs = ts;
      const frameDt = prevFrameTs === 0 ? frameInterval : ts - prevFrameTs;
      prevFrameTs = ts;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(scaleX, 0, 0, scaleY, -minX * scaleX, -minY * scaleY);

      const t0 = performance.now();
      const now = performance.now();
      agentsRef.current.forEach((a, i) => {
        if (a.moving) {
          const dx = a.tx - a.x;
          const dy = a.ty - a.y;
          const d = Math.hypot(dx, dy);
          if (d > 0.5) {
            const step = a.speed;
            a.x += (dx / d) * step;
            a.y += (dy / d) * step;
          } else {
            a.moving = false;
          }
          {
            const mx = 120;
            const dL = a.x - boundX;
            const dR = boundX + boundW - a.x;
            const dT = a.y - boundY;
            const dB = boundY + boundH - a.y;
            if (dL < mx) a.x += (mx - dL) * 0.015;
            if (dR < mx) a.x -= (mx - dR) * 0.015;
            if (dT < mx) a.y += (mx - dT) * 0.015;
            if (dB < mx) a.y -= (mx - dB) * 0.015;
          }
          a.x = Math.max(boundX, Math.min(boundX + boundW, a.x));
          a.y = Math.max(boundY, Math.min(boundY + boundH, a.y));

          for (let k = 0; k < 6; k++) {
            const j = Math.floor(Math.random() * agentsRef.current.length);
            if (j === i) continue;
            const b = agentsRef.current[j];
            const sdx = a.x - b.x;
            const sdy = a.y - b.y;
            const dist = Math.hypot(sdx, sdy);
            const sep = 32;
            if (dist > 0 && dist < sep) {
              const push = (sep - dist) / sep * 0.3;
              a.x += (sdx / dist) * push;
              a.y += (sdy / dist) * push;
            }
          }
        } else if (now < a.jitterUntil) {
          a.x += (Math.random() - 0.5) * 0.6;
          a.y += (Math.random() - 0.5) * 0.6;
          {
            const mx = 120;
            const dL = a.x - boundX;
            const dR = boundX + boundW - a.x;
            const dT = a.y - boundY;
            const dB = boundY + boundH - a.y;
            if (dL < mx) a.x += (mx - dL) * 0.015;
            if (dR < mx) a.x -= (mx - dR) * 0.015;
            if (dT < mx) a.y += (mx - dT) * 0.015;
            if (dB < mx) a.y -= (mx - dB) * 0.015;
          }
          a.x = Math.max(boundX, Math.min(boundX + boundW, a.x));
          a.y = Math.max(boundY, Math.min(boundY + boundH, a.y));
        }

        a.phase += 0.01;
        const pulse = 0.5 + Math.sin(a.phase) * 0.5;
        const isMoving = a.moving;
        const idx = Math.min(SPRITE_FRAMES - 1, Math.max(0, Math.floor(pulse * (SPRITE_FRAMES - 1))));
        const sprite = isMoving ? spriteMovingRef.current[idx] : spriteIdleRef.current[idx];
        const s = SPRITE_WORLD_SIZE;
        if (sprite) {
          ctx.drawImage(sprite, a.x - s / 2, a.y - s / 2, s, s);
        }

        if (isMoving) {
          const rp = ((now + a.id * 97) % 1000) / 1000;
          const ringBase = 24;
          const ringRange = 60;
          const r1 = ringBase + rp * ringRange;
          const a1 = 0.30 * (1 - rp);
          ctx.beginPath();
          ctx.arc(a.x, a.y, r1, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(16,185,129,${a1})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      });
      
      ctx.restore();
      const t1 = performance.now();
      const busy = t1 - t0;
      const alpha = 0.2;
      perfStateRef.current.busyAvg = perfStateRef.current.busyAvg * (1 - alpha) + busy * alpha;
      perfStateRef.current.frameAvg = perfStateRef.current.frameAvg * (1 - alpha) + frameDt * alpha;
      perfStateRef.current.fps = perfStateRef.current.frameAvg > 0 ? Math.round(1000 / perfStateRef.current.frameAvg) : 0;
      if (t1 - lastUiAt > 500) {
        lastUiAt = t1;
        const pct = Math.max(0, Math.min(100, Math.round((perfStateRef.current.busyAvg / frameInterval) * 100)));
        setPerfUI({ busyPct: pct, fps: perfStateRef.current.fps, longTasks: perfStateRef.current.longTasks });
        perfStateRef.current.longTasks = 0;
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearInterval(moveTimer);
      clearInterval(jitterTimer);
      delete window.svgGatherTopRight;
      window.removeEventListener("resize", setCanvasSize);
    };
  }, [viewBox]);

  const metrics = useMemo(() => {
    return {
      count: 300,
      density: Math.round((300 / 4000) * 100) / 10,
    };
  }, []);

  const aspectRatio = useMemo(() => {
    const parts = viewBox.split(" ").map(Number);
    const w = parts[2] || 1;
    const h = parts[3] || 1;
    return w / h;
  }, [viewBox]);

  // 动态计算适配容器的尺寸
  // const [wrapperStyle, setWrapperStyle] = useState({ width: "100%", height: "100%" });

  // useEffect(() => {
  //   if (!containerRef.current) return;
    
  //   const updateSize = () => {
  //     const container = containerRef.current;
  //     if (!container) return;
  //     const cw = container.clientWidth;
  //     const ch = container.clientHeight;
  //     if (cw === 0 || ch === 0) return;

  //     const containerRatio = cw / ch;

  //     // Contain 模式：始终完整显示
  //     if (containerRatio > aspectRatio) {
  //       // 容器更宽，高度占满，宽度自适应（会有左右留白）
  //       const w = ch * aspectRatio;
  //       setWrapperStyle({ width: `${w}px`, height: `${ch}px` });
  //     } else {
  //       // 容器更高，宽度占满，高度自适应（会有上下留白）
  //       const h = cw / aspectRatio;
  //       setWrapperStyle({ width: `${cw}px`, height: `${h}px` });
  //     }
  //   };

  //   const ro = new ResizeObserver(updateSize);
  //   ro.observe(containerRef.current);
  //   updateSize();

  //   return () => ro.disconnect();
  // }, [aspectRatio]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-[#0b1220] overflow-hidden" ref={containerRef}>
      {/* 背景装饰 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05),rgba(0,0,0,0)_70%)]" />
      
      <div 
        className="relative h-full max-w-full shadow-2xl transition-all duration-300 ease-out md:min-w-[500px]"
        style={{ aspectRatio: aspectRatio }}
      >
          <img
            src="/topoexport_2D_vectorial.svg"
            alt="Floorplan"
            className="absolute inset-0 h-full w-full select-none"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full opacity-80 drop-shadow-[0_0_15px_rgba(99,102,241,0.3)]"
            style={{ filter: "drop-shadow(0 0 1px rgba(255,255,255,0.1))" }}
          />
      </div>

      {/* 悬浮指标 */}
      <div className="absolute left-6 top-6 rounded-xl bg-black/40 px-4 py-3 text-xs ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-center gap-2">
           <span className="size-2 rounded-full bg-emerald-400 animate-pulse"/>
           <span className="text-zinc-300">SVG 矢量视图</span>
        </div>
        <div className="mt-2 text-zinc-400">
           人群密度: <span className="text-zinc-200">{metrics.density}%</span>
        </div>
      </div>
      <div className="absolute top-6 right-6 rounded-xl bg-black/40 px-4 py-3 text-xs ring-1 ring-white/10 backdrop-blur-md text-zinc-300">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-cyan-400"/>
          <span>性能监控</span>
        </div>
        <div className="mt-2 text-zinc-400">CPU 估算: <span className="text-zinc-200">{perfUI.busyPct}%</span></div>
        <div className="mt-1 text-zinc-400">FPS: <span className="text-zinc-200">{perfUI.fps}</span></div>
        <div className="mt-1 text-zinc-400">长任务: <span className="text-zinc-200">{perfUI.longTasks}</span></div>
      </div>
      
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
         <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-[10px] text-zinc-400 ring-1 ring-white/5 backdrop-blur-md">
            <div className="size-1.5 rounded-full bg-[#34d399]" /> 活跃访客
         </div>
      </div>
    </div>
  );
}
