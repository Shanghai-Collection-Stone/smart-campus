"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";

type DecisionPriority = "low" | "medium" | "high";
type DecisionStatus = "idle" | "executing" | "deferred" | "closed";

interface Decision {
  id: string;
  title: string;
  description: string;
  priority: DecisionPriority;
}

const decisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]),
});

const impactSchema = z.object({ expectedImpact: z.number().int().min(0).max(100000) });

function isDecision(v: unknown): v is Decision {
  const ok = decisionSchema.safeParse(v);
  return ok.success;
}

function generateId() {
  const t = Date.now();
  const r = Math.floor(Math.random() * 1000000);
  return `dec-${t}-${r}`;
}

export default function RemoteControlPage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateValue, setEstimateValue] = useState<number | null>(null);
  const [publishStatus, setPublishStatus] = useState<string>("");
  const [expectedImpactInput, setExpectedImpactInput] = useState<string>("");
  const [statuses, setStatuses] = useState<Record<string, DecisionStatus>>({});
  const [lastAiMessage, setLastAiMessage] = useState<string>("");
  const decRef = useRef<Decision[]>([]);
  useEffect(() => { decRef.current = decisions; }, [decisions]);
  const [startTimes, setStartTimes] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => { clearInterval(t); };
  }, []);

  const detectionText = useMemo(() => {
    return "AI智能检测 C区人流量很少，建议派发优惠券来吸引客流";
  }, []);

  function executeDecisionById(id: string) {
    const s = socketRef.current;
    if (!s) return;
    const ok = decisions.some((d) => d.id === id);
    if (!ok) return;
    s.emit("decision:executed", { id });
    setStatuses((prev) => ({ ...prev, [id]: "executing" }));
    setStartTimes((prev) => ({ ...prev, [id]: Date.now() }));
  }

  function deferDecisionById(id: string) {
    const s = socketRef.current;
    if (!s) return;
    s.emit("decision:defer", { id });
    setStatuses((prev) => ({ ...prev, [id]: "deferred" }));
  }

  function closeDecisionById(id: string) {
    const s = socketRef.current;
    if (!s) return;
    s.emit("decision:close", { id });
    setStatuses((prev) => ({ ...prev, [id]: "closed" }));
  }

  useEffect(() => {
    const s = io({ path: "/api/socket", transports: ["websocket"], autoConnect: true, reconnection: true });
    socketRef.current = s;
    const onConnect = () => {
      setConnected(true);
      s.emit("decision:join");
      s.emit("decision:list");
    };
    const onDisconnect = () => { setConnected(false); };
    const onUpdate = (payload: unknown) => {
      const arr = (payload && typeof payload === "object" && payload !== null && (payload as Record<string, unknown>).decisions) as unknown;
      if (Array.isArray(arr)) {
        const next: Decision[] = [];
        for (let i = 0; i < arr.length; i++) {
          if (isDecision(arr[i])) next.push(arr[i]);
        }
        setDecisions(next);
      }
      const statRaw = (payload && typeof payload === "object" && payload !== null && (payload as Record<string, unknown>).statuses) as unknown;
      if (statRaw && typeof statRaw === "object" && statRaw !== null) {
        const sobj = statRaw as Record<string, unknown>;
        const nextStat: Record<string, DecisionStatus> = {};
        const nextStart: Record<string, number> = {};
        Object.keys(sobj).forEach((id) => {
          const v = sobj[id] as Record<string, unknown>;
          const st = typeof v?.status === "string" ? (v!.status as DecisionStatus) : undefined;
          const ts = typeof v?.startAt === "number" ? (v!.startAt as number) : undefined;
          if (st) nextStat[id] = st;
          if (st === "executing" && typeof ts === "number") nextStart[id] = ts;
        });
        setStatuses((prev) => ({ ...prev, ...nextStat }));
        setStartTimes((prev) => ({ ...prev, ...nextStart }));
      }
    };
    const onEstimate = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const inc = obj && typeof obj.inc === "number" ? obj.inc : null;
      if (typeof inc === "number") setEstimateValue(inc);
      setEstimateLoading(false);
    };
    const onAssistantMessage = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const msg = obj && typeof obj.message === "string" ? obj.message : "";
      if (msg) setLastAiMessage(msg);
    };
    const onExecuted = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "executing" }));
    };
    const onDeferred = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "deferred" }));
    };
    const onClosed = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      if (!id) return;
      setStatuses((prev) => ({ ...prev, [id]: "closed" }));
    };
    const onExecuteCommand = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      const indexVal = obj && typeof obj.index === "number" ? obj.index : null;
      let targetId = id;
      if (!targetId && typeof indexVal === "number") {
        const idx = Math.max(1, Math.floor(indexVal));
        if (idx >= 1 && idx <= decisions.length) {
          targetId = decisions[idx - 1].id;
        }
      }
      if (!targetId) return;
      executeDecisionById(targetId);
    };
    const onExecuteAsk = (payload: unknown) => {
      const count = typeof (payload as Record<string, unknown>)?.count === "number" ? (payload as Record<string, unknown>).count as number : decRef.current.length;
      const input = typeof window !== "undefined" ? window.prompt(`请选择要执行的第几条 (1-${count})`) : null;
      if (!input) return;
      const num = Number(input);
      if (!Number.isFinite(num)) return;
      const idx = Math.max(1, Math.floor(num));
      const s = socketRef.current;
      if (!s) return;
      s.emit("decision:execute", { index: idx });
    };
    const onStatus = (payload: unknown) => {
      const obj = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
      const id = obj && typeof obj.id === "string" ? obj.id : "";
      const st = obj && typeof obj.status === "string" ? (obj.status as DecisionStatus) : undefined;
      const ts = obj && typeof (obj as Record<string, unknown>).startAt === "number" ? (obj as Record<string, unknown>).startAt as number : undefined;
      if (!id || !st) return;
      setStatuses((prev) => ({ ...prev, [id]: st }));
      if (st === "executing" && typeof ts === "number") {
        setStartTimes((prev) => ({ ...prev, [id]: ts }));
      }
    };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("decision:update", onUpdate);
    s.on("decision:estimate", onEstimate);
    s.on("assistant_message", onAssistantMessage);
    s.on("decision:executed", onExecuted);
    s.on("decision:deferred", onDeferred);
    s.on("decision:closed", onClosed);
    s.on("decision:execute", onExecuteCommand);
    s.on("decision:execute:ask", onExecuteAsk);
    s.on("decision:status", onStatus);
    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("decision:update", onUpdate);
      s.off("decision:estimate", onEstimate);
      s.off("assistant_message", onAssistantMessage);
      s.off("decision:executed", onExecuted);
      s.off("decision:deferred", onDeferred);
      s.off("decision:closed", onClosed);
      s.off("decision:execute", onExecuteCommand);
      s.off("decision:execute:ask", onExecuteAsk);
      s.off("decision:status", onStatus);
      s.disconnect();
    };
  }, []);

  const publishDecision = () => {
    const s = socketRef.current;
    if (!s) return;
    const payload: Decision = {
      id: generateId(),
      title: "C区派发优惠券",
      description: detectionText,
      priority: "high",
    };
    const ok = decisionSchema.safeParse(payload);
    if (!ok.success) {
      setPublishStatus("校验失败");
      return;
    }
    setPublishStatus("发布中...");
    s.emit("decision:push", payload);
    setTimeout(() => {
      setPublishStatus("已发布");
    }, 300);
  };

  const requestEstimate = () => {
    const s = socketRef.current;
    if (!s) return;
    const id = generateId();
    setEstimateLoading(true);
    setEstimateValue(null);
    s.emit("decision:estimate", { id });
  };

  const onImpactSubmit = () => {
    const num = Number(expectedImpactInput);
    const res = impactSchema.safeParse({ expectedImpact: num });
    if (!res.success) {
      setPublishStatus("人数格式不正确");
      return;
    }
    setEstimateValue(res.data.expectedImpact);
    setPublishStatus("人数已设定");
  };

  const fmt = (from?: number) => {
    const t = typeof from === "number" ? from : nowMs;
    const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };


  return (
    <div className="min-h-screen w-full bg-zinc-50 dark:bg-black flex items-start justify-center py-10 px-6">
      <div className="w-full max-w-3xl rounded-2xl bg-white/90 dark:bg-zinc-900 ring-1 ring-black/10 dark:ring-white/10 backdrop-blur p-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-3 rounded-full bg-cyan-500 animate-pulse" />
            <h1 className="text-xl font-semibold tracking-wide text-zinc-900 dark:text-zinc-100">遥控中心</h1>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{connected ? "已连接" : "未连接"}</div>
        </div>

        <div className="rounded-xl bg-black/5 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 p-4">
          <div className="text-sm text-zinc-700 dark:text-zinc-200">{detectionText}</div>
          {lastAiMessage ? (
            <div className="mt-2 rounded-lg bg-white/60 dark:bg-zinc-800/60 ring-1 ring-black/10 dark:ring-white/10 p-3 text-xs text-zinc-700 dark:text-zinc-200">
              AI建议：{lastAiMessage}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={publishDecision}
              className="col-span-1 inline-flex items-center justify-center rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm h-10"
              aria-label="发布决策"
            >
              发布决策
            </button>
            <button
              type="button"
              onClick={requestEstimate}
              className="col-span-1 inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm h-10"
              aria-label="计算预计影响人数"
            >
              {estimateLoading ? "计算中..." : "计算预计影响人数"}
            </button>
            <div className="col-span-1 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                value={expectedImpactInput}
                onChange={(e) => setExpectedImpactInput(e.currentTarget.value)}
                className="flex-1 h-10 rounded-lg bg-white dark:bg-zinc-800 ring-1 ring-black/10 dark:ring-white/10 px-3 text-sm text-zinc-900 dark:text-zinc-100"
                placeholder="自定义人数"
                aria-label="自定义预计影响人数"
              />
              <button
                type="button"
                onClick={onImpactSubmit}
                className="h-10 px-4 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm"
                aria-label="设定人数"
              >
                设定
              </button>
            </div>
          </div>
          <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            预计影响人数：<span className="font-medium text-zinc-900 dark:text-zinc-200">{typeof estimateValue === "number" ? `${estimateValue} 人` : "--"}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">状态：<span className="font-medium">{publishStatus || "--"}</span></div>
        </div>

        <div className="rounded-xl bg-black/5 dark:bg-white/5 ring-1 ring-black/10 dark:ring-white/10 p-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">已发布决策列表</div>
          <div className="flex flex-col gap-2">
            {decisions.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">暂无</div>
            ) : (
              decisions.map((d) => (
                <div key={d.id} className="rounded-lg bg-white dark:bg-zinc-800 ring-1 ring-black/10 dark:ring-white/10 p-3">
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{d.title}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{d.description}</div>
                  <div className="mt-1 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ring-black/10 dark:ring-white/10 text-zinc-700 dark:text-zinc-200 bg-black/5 dark:bg-white/5">
                      优先级: {d.priority}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {statuses[d.id] === "executing" ? (
                      <button
                        type="button"
                        disabled
                        className="h-8 px-3 rounded-md bg-emerald-600 text-white text-xs opacity-90"
                        aria-label="执行中"
                      >
                        执行时长 {fmt(startTimes[d.id])}
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => executeDecisionById(d.id)}
                          className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                          aria-label="执行"
                        >
                          执行
                        </button>
                        <button
                          type="button"
                          onClick={() => deferDecisionById(d.id)}
                          className="h-8 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs"
                          aria-label="稍后"
                        >
                          稍后
                        </button>
                        <button
                          type="button"
                          onClick={() => closeDecisionById(d.id)}
                          className="h-8 px-3 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs"
                          aria-label="关闭"
                        >
                          关闭
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
