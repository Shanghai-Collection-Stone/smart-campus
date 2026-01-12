"use client";
import { useEffect, useMemo, useState } from "react";
import { onPanelAction } from "./panelBus";
import { setPanelAck } from "./panelBus";
import { mockMonthlyReports, type MonthlyReport } from "../mock";

export default function MonthlyReportModal() {
  const [open, setOpen] = useState(false);
  const [monthKey, setMonthKey] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [vTotal, setVTotal] = useState(0);
  const [rTotal, setRTotal] = useState(0);
  const [oTotal, setOTotal] = useState(0);
  const [aov, setAov] = useState(0);
  const data: MonthlyReport | null = useMemo(() => {
    const k = monthKey.trim();
    if (!k) return null;
    const d = mockMonthlyReports[k];
    return d ? d : null;
  }, [monthKey]);

  useEffect(() => {
    const off = onPanelAction((a) => {
      if (a && (a as { kind?: string }).kind === "report:open") {
        const m = (a as { month?: string }).month;
        if (typeof m === "string" && mockMonthlyReports[m]) {
          setMonthKey(m);
          setOpen(true);
          setReady(false);
          setPanelAck(true);
        } else {
          setPanelAck(false, "unknown_month");
        }
      } else if (a && (a as { kind?: string }).kind === "report:close") {
        setOpen(false);
        setMonthKey("");
        setReady(false);
        setPanelAck(true);
      }
    });
    return () => off();
  }, []);

  useEffect(() => {
    const data: MonthlyReport | null = (() => {
      const k = monthKey.trim();
      if (!k) return null;
      const d = mockMonthlyReports[k];
      return d ? d : null;
    })();
    if (!open || !data) return;
    const t0 = performance.now();
    const dur = 600;
    const tick = (ts: number) => {
      const p = Math.min(1, (ts - t0) / dur);
      const ease = 0.5 - Math.cos(Math.PI * p) / 2;
      setVTotal(Math.floor(data.visitorsTotal * ease));
      setRTotal(Math.floor(data.revenueTotal * ease));
      setOTotal(Math.floor(data.ordersTotal * ease));
      setAov(Math.floor(data.avgOrderValue * ease));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(() => {
      setVTotal(0); setRTotal(0); setOTotal(0); setAov(0);
      setReady(true);
      requestAnimationFrame(tick);
    });
  }, [open, monthKey]);

  if (!open || !data) return null;

  const close = () => {
    setOpen(false);
    setMonthKey("");
  };

  const fmt = (n: number) => n.toLocaleString();
  const monthLabel = (() => {
    const parts = monthKey.split("-");
    if (parts.length === 2) return `${Number(parts[1])}月`;
    return monthKey;
  })();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-glow-in" onClick={close} />
      <div className="relative w-[92%] max-w-[1080px] rounded-2xl bg-[#0b1220] ring-1 ring-white/10 shadow-2xl overflow-hidden animate-modal-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="text-xs text-zinc-400">月度详细报表</div>
            <div className="text-lg font-semibold tracking-wider">
              {monthLabel} · {data.monthKey}
            </div>
          </div>
          <button
            className="rounded-lg bg-white/5 text-zinc-300 hover:bg-white/10 ring-1 ring-white/10 p-2"
            onClick={close}
            aria-label="关闭"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="col-span-1 grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
              <div className="text-xs text-zinc-400">总人数</div>
              <div className="mt-2 text-2xl font-semibold">
                {fmt(vTotal)} <span className="text-xs text-zinc-500">人</span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-linear-to-r from-emerald-400 to-cyan-500" style={{ width: ready ? "70%" : "0%", transition: "width 700ms cubic-bezier(.22,.61,.36,1)" }} />
              </div>
            </div>
            <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
              <div className="text-xs text-zinc-400">总金额</div>
              <div className="mt-2 text-2xl font-semibold">¥ {fmt(rTotal)}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-linear-to-r from-violet-500 to-amber-400" style={{ width: ready ? "72%" : "0%", transition: "width 720ms cubic-bezier(.22,.61,.36,1)" }} />
              </div>
            </div>
            <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
              <div className="text-xs text-zinc-400">订单数</div>
              <div className="mt-2 text-2xl font-semibold">{fmt(oTotal)}</div>
              <div className="text-[10px] text-zinc-500">转化率 {Math.round(data.conversionRate)}%</div>
            </div>
            <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
              <div className="text-xs text-zinc-400">平均客单价</div>
              <div className="mt-2 text-2xl font-semibold">¥ {fmt(aov)}</div>
              <div className="text-[10px] text-zinc-500">按月度订单口径计算</div>
            </div>
          </div>

          <div className="col-span-1 rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">周度趋势</div>
            <div className="mt-4 grid grid-cols-2 gap-6">
              <div>
                <div className="text-[10px] text-zinc-500 mb-2">周营收</div>
                <div className="flex items-end gap-1 h-24">
                  {data.weeklyRevenue.map((v, i) => {
                    const h = `${Math.min(100, Math.round((v / data.revenueTotal) * 220))}%`;
                    return (
                      <div key={i} className="w-3 rounded-t-sm bg-linear-to-t from-violet-500/20 to-violet-400" style={{ height: ready ? h : "0%", transition: `height ${500 + i * 60}ms cubic-bezier(.22,.61,.36,1)` }} />
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 mb-2">周人数</div>
                <div className="flex items-end gap-1 h-24">
                  {data.weeklyVisitors.map((v, i) => {
                    const h = `${Math.min(100, Math.round((v / data.visitorsTotal) * 220))}%`;
                    return (
                      <div key={i} className="w-3 rounded-t-sm bg-linear-to-t from-emerald-500/20 to-emerald-400" style={{ height: ready ? h : "0%", transition: `height ${500 + i * 60}ms cubic-bezier(.22,.61,.36,1)` }} />
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-[10px] text-zinc-500">渠道占比</div>
                <div className="mt-2 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-300">线下POS</span>
                      <span className="text-zinc-400">{data.channels.pos}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full mt-1">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: ready ? `${data.channels.pos}%` : "0%", transition: "width 700ms cubic-bezier(.22,.61,.36,1)" }} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-zinc-300">线上小程序</span>
                      <span className="text-zinc-400">{data.channels.miniapp}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full mt-1">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: ready ? `${data.channels.miniapp}%` : "0%", transition: "width 700ms cubic-bezier(.22,.61,.36,1)" }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-white/5 p-3">
                <div className="text-[10px] text-zinc-500">客群结构</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="text-[11px] text-zinc-300">新客 {data.segments.newCustomerRate}%</div>
                  <div className="text-[11px] text-zinc-300">复购 {data.segments.repeatRate}%</div>
                  <div className="text-[11px] text-zinc-300">男 {data.segments.maleRate}%</div>
                  <div className="text-[11px] text-zinc-300">女 {data.segments.femaleRate}%</div>
                </div>
                <div className="mt-2 flex items-end gap-1 h-20">
                  {data.segments.ageGroups.map((g, i) => (
                    <div key={g.label} className="flex flex-col items-center">
                      <div className="w-3 rounded-t-sm bg-linear-to-t from-emerald-500/20 to-emerald-400" style={{ height: ready ? `${Math.min(100, g.rate * 2)}%` : "0%", transition: `height ${480 + i * 60}ms cubic-bezier(.22,.61,.36,1)` }} />
                      <div className="mt-1 text-[10px] text-zinc-500">{g.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-1 rounded-xl bg-black/30 p-5 ring-1 ring-white/10">
            <div className="text-xs text-zinc-400">AI 建议（模拟）</div>
            <div className="mt-4 space-y-3">
              {data.advices.map((t, i) => (
                <div key={i} className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10 text-sm text-zinc-200 animate-fade-in-up" style={{ animationDelay: `${80 * i}ms` }}>
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
