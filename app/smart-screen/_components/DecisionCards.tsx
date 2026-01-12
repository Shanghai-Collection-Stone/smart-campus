 "use client";
 import { useEffect, useRef, useState } from "react";
 import { io, Socket } from "socket.io-client";

type Decision = {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
};

type DecisionStatus = "pending" | "executing" | "deferred" | "closed";

/**
 * 智能决策卡片列表组件
 * 展示系统生成的建议决策，并提供操作按钮
 * @param {Object} props - 组件属性
 * @param {Decision[]} props.decisions - 决策数据列表
 * @returns {JSX.Element} 决策卡片列表
 * @keyword-en DecisionCards, smartDecision, recommendation
 */
export default function DecisionCards() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DecisionStatus>>({});
  const [startTimes, setStartTimes] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState<number>(0);
  const [modal, setModal] = useState<{ open: boolean; title: string; inc: number } | null>(null);
  const sockRef = useRef<Socket | null>(null);
  const decisionsRef = useRef<Decision[]>([]);

  const handleExecute = (d: Decision) => {
    const s = sockRef.current;
    if (!s) return;
    const once = (payload: unknown) => {
      const p = (payload ?? {}) as Record<string, unknown>;
      const id = typeof p.id === "string" ? p.id : "";
      if (id !== d.id) return;
      const incRaw = p.inc as unknown;
      const inc = typeof incRaw === "number" ? incRaw : 30;
      setModal({ open: true, title: d.title, inc });
      try {
        if (typeof window !== "undefined" && typeof window.svgGatherTopRight === "function") {
          window.svgGatherTopRight(inc);
        }
      } catch {}
      s.emit("decision:executed", { id: d.id, inc });
      setStatuses((prev) => ({ ...prev, [d.id]: "executing" }));
      setStartTimes((prev) => ({ ...prev, [d.id]: Date.now() }));
      setTimeout(() => setModal(null), 2000);
    };
    s.once("decision:estimate", once);
    s.emit("decision:estimate", { id: d.id });
  };

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    const s = io(origin, {
      path: "/api/socket",
      transports: ["websocket"],
      withCredentials: true,
    });
    s.on("connect", () => {
      s.emit("decision:join");
      s.emit("decision:list");
    });
    s.on("decision:update", (payload: unknown) => {
      const p = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
      const raw = p.decisions;
      const list = Array.isArray(raw) ? raw : [];
      const next: Decision[] = [];
      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        if (typeof x !== "object" || x === null) continue;
        const obj = x as Record<string, unknown>;
        const id = obj.id;
        const title = obj.title;
        const description = obj.description;
        const pr = obj.priority;
        if (typeof id === "string" && typeof title === "string" && typeof description === "string" && (pr === "low" || pr === "medium" || pr === "high")) {
          next.push({ id, title, description, priority: pr });
        }
      }
      setDecisions(next);
      decisionsRef.current = next;
    });
    s.on("decision:status", (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      const status = obj && typeof obj.status === "string" ? obj.status : "";
      const startAt = obj && typeof (obj as Record<string, unknown>).startAt === "number" ? (obj as Record<string, unknown>).startAt as number : undefined;
      const valid = status === "pending" || status === "executing" || status === "deferred" || status === "closed";
      if (!id || !valid) return;
      setStatuses((prev) => ({ ...prev, [id]: status as DecisionStatus }));
      if (status === "executing" && typeof startAt === "number") {
        setStartTimes((prev) => ({ ...prev, [id]: startAt }));
      }
    });
    s.on("decision:execute", (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      if (!obj) return;
      const id = typeof obj.id === "string" ? obj.id : "";
      const idxRaw = obj.index as unknown;
      const idx = typeof idxRaw === "number" ? idxRaw : NaN;
      if (id) {
        const found = decisionsRef.current.find((d) => d.id === id);
        if (found) handleExecute(found);
        return;
      }
      const list = decisionsRef.current;
      if (Number.isFinite(idx) && idx >= 1 && idx <= list.length) {
        const d = list[idx - 1];
        if (d) handleExecute(d);
      }
    });
    s.on("decision:executed", (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "executing" }));
      setStartTimes((prev) => ({ ...prev, [id]: Date.now() }));
    });
    s.on("decision:deferred", (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "deferred" }));
    });
    s.on("decision:closed", (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "closed" }));
    });
    sockRef.current = s;
    return () => {
      try { s.disconnect(); } catch {}
      sockRef.current = null;
      clearInterval(t);
    };
  }, []);


  const handleDefer = (d: Decision) => {
    const s = sockRef.current;
    if (!s) return;
    s.emit("decision:defer", { id: d.id });
    setStatuses((prev) => ({ ...prev, [d.id]: "deferred" }));
  };

  const handleClose = (d: Decision) => {
    const s = sockRef.current;
    if (!s) return;
    s.emit("decision:close", { id: d.id });
    setStatuses((prev) => ({ ...prev, [d.id]: "closed" }));
  };

  return (
    <div className="decision-cards grid gap-4">
      {decisions.map((d) => (
        <div
          key={d.id}
          className="decision-cards__item group relative overflow-hidden rounded-2xl border border-white/5 bg-black/40 p-4 transition-all duration-300 hover:border-amber-500/30 hover:bg-white/5 hover:shadow-lg hover:shadow-amber-500/5"
        >
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors text-[clamp(12px,1.2vw,14px)]">
              {d.title}
            </h3>
            {(() => {
              const st = statuses[d.id] || "pending";
              const label = st === "executing" ? "执行中" : st === "deferred" ? "稍后" : st === "closed" ? "已关闭" : "待处理";
              const color = st === "executing" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" : st === "deferred" ? "bg-amber-500/10 text-amber-400 ring-amber-500/20" : st === "closed" ? "bg-zinc-500/10 text-zinc-300 ring-zinc-500/20" : "bg-amber-500/10 text-amber-400 ring-amber-500/20";
              return <div className={`rounded-full px-2 py-0.5 font-medium ring-1 text-[clamp(10px,1vw,12px)] ${color}`}>{label}</div>;
            })()}
          </div>
          
          <p className="text-zinc-500 line-clamp-2 leading-relaxed mb-4 text-[clamp(11px,1.1vw,12px)]">
            {d.description}
          </p>

          <div className="flex items-center gap-2">
            <button className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-black transition-all active:scale-95 hover:bg-amber-400 shadow-md shadow-amber-500/20 text-[clamp(11px,1.1vw,12px)]" onClick={() => handleExecute(d)} disabled={statuses[d.id] === "executing"}>
              {statuses[d.id] === "executing" ? (() => { const t0 = startTimes[d.id] || nowMs; const sec = Math.max(0, Math.floor((nowMs - t0) / 1000)); const mm = String(Math.floor(sec / 60)).padStart(2, "0"); const ss = String(sec % 60).padStart(2, "0"); return `执行时长 ${mm}:${ss}`; })() : "立即执行"}
            </button>
            {statuses[d.id] === "executing" ? null : (
              <>
                <button className="rounded-lg bg白/5 px-3 py-1.5 font-medium text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 ring-1 ring-white/10 text-[clamp(11px,1.1vw,12px)]" onClick={() => handleDefer(d)}>
                  稍后
                </button>
                <button className="flex items-center justify-center rounded-lg text-zinc-500 transition-colors hover:text-rose-400 hover:bg-rose-400/10 w-[clamp(28px,2.6vw,32px)] h-[clamp(28px,2.6vw,32px)]" onClick={() => handleClose(d)} aria-label="关闭">
                  <svg className="fill-none stroke-current w-[clamp(14px,1.6vw,16px)] h-[clamp(14px,1.6vw,16px)]" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* 装饰性背景 */}
          <div className="absolute -right-4 -bottom-4 size-20 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-colors" />
        </div>
      ))}
      {decisions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
          <div className="relative">
            <div className="size-12 rounded-full bg-amber-500/5 flex items-center justify-center ring-1 ring-amber-500/10">
              <svg className="size-6 text-amber-500/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="absolute inset-0 animate-pulse rounded-full bg-amber-500/5 ring-1 ring-amber-500/10 scale-150 blur-xl" />
          </div>
          <div className="text-center space-y-1">
            <div className="text-sm font-medium text-zinc-500/80">系统持续分析中</div>
            <p className="text-[10px] text-zinc-600 max-w-[160px] leading-relaxed">
              实时监测园区人流与动态，<br/>新建议生成后将即时同步
            </p>
          </div>
          <div className="flex gap-1.5 opacity-30">
            <div className="size-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "0ms" }} />
            <div className="size-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "150ms" }} />
            <div className="size-1 rounded-full bg-amber-500 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        </div>
      )}
      {modal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative rounded-2xl border border-white/10 bg-black/70 px-6 py-4 text-center shadow-xl">
            <div className="text-sm font-semibold text-amber-400 mb-1">{modal.title}</div>
            <div className="text-[12px] text-zinc-300">预计涨 {modal.inc} 人</div>
          </div>
        </div>
      )}
    </div>
  );
}
