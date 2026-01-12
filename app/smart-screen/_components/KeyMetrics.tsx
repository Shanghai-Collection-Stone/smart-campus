"use client";
import { useEffect, useRef, useState } from "react";
import type { Stat } from "../mock";
import { useMemo } from "react";
import { onPanelAction, type PanelAction, type MetricKey } from "./panelBus";
import { setPanelAck } from "./panelBus";

function useCountUp(target: number, duration = 1000) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const step = (ts: number) => {
      if (startRef.current == null) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / duration);
      setValue(Math.floor(target * (0.5 - Math.cos(Math.PI * p) / 2)));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);
  return value;
}

export default function KeyMetrics({ stats }: { stats: Stat }) {
  const [labels, setLabels] = useState<Record<MetricKey, string>>({
    revenue: "今日金额",
    visitors: "今日来客",
    conversion: "转化率",
    dwell: "平均停留",
    energy: "今日能耗",
    wifi: "WiFi终端",
  });
  const [values, setValues] = useState<Record<MetricKey, number>>({
    revenue: stats.revenue,
    visitors: stats.visitors,
    conversion: stats.conversionRate,
    dwell: stats.dwellTimeAvgMin,
    energy: stats.energyKwh,
    wifi: stats.wifiConnections,
  });
  const [flip, setFlip] = useState<Record<MetricKey, boolean>>({
    revenue: false,
    visitors: false,
    conversion: false,
    dwell: false,
    energy: false,
    wifi: false,
  });

  // 初始值来自 props，后续由面板动作驱动变更

  useEffect(() => {
    const off = onPanelAction((a: PanelAction) => {
      if (a.kind === "metric:set") {
        setLabels((prev) => ({ ...prev, [a.target]: typeof a.label === "string" ? a.label : prev[a.target] }));
        const makeSeed = (s: string) => Array.from(s).reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const base = values[a.target];
        const next = typeof a.value === "number" ? a.value : (() => {
          const label = typeof a.label === "string" ? a.label : labels[a.target];
          const seed = makeSeed(String(label)) + new Date().getDate();
          const r = 0.85 + ((seed % 100) / 1000) * 3;
          if (a.target === "conversion") return Math.max(1, Math.round(base * (0.96 + ((seed % 7) / 100))));
          if (a.target === "dwell") return Math.max(1, Math.round(base * (0.9 + ((seed % 5) / 100))));
          return Math.max(1, Math.round(base * r));
        })();
        setValues((prev) => ({ ...prev, [a.target]: next }));
        setFlip((prev) => ({ ...prev, [a.target]: !!a.flip }));
        setPanelAck(true);
      } else if (a.kind === "metric:updateByLabel") {
        const detectTarget = (label: string): MetricKey | undefined => {
          const l = label.trim();
          const pairs: Array<{ k: MetricKey; kw: string[] }> = [
            { k: "revenue", kw: ["金额", "营收", "交易", "收入"] },
            { k: "visitors", kw: ["来客", "人流", "人数", "访客"] },
            { k: "conversion", kw: ["转化", "成交", "转化率"] },
            { k: "dwell", kw: ["停留", "停留时长", "平均停留"] },
            { k: "energy", kw: ["能耗", "电量", "用电"] },
            { k: "wifi", kw: ["WiFi", "无线", "终端"] },
          ];
          for (const { k, kw } of pairs) {
            for (const w of kw) {
              if (l.includes(w)) return k;
            }
          }
          const entries = Object.entries(labels) as Array<[MetricKey, string]>;
          for (const [k, v] of entries) {
            if (l === v || v.includes(l) || l.includes(v)) return k;
          }
          return undefined;
        };
        const target = detectTarget(a.oldLabel);
        if (!target) { setPanelAck(false, "unknown_label"); return; }
        setLabels((prev) => ({ ...prev, [target]: typeof a.newLabel === "string" ? a.newLabel : prev[target] }));
        const makeSeed = (s: string) => Array.from(s).reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const base = values[target];
        const next = typeof a.value === "number" ? a.value : (() => {
          const label = typeof a.newLabel === "string" ? a.newLabel : a.oldLabel;
          const seed = makeSeed(String(label)) + new Date().getDate();
          const r = 0.86 + ((seed % 100) / 1000) * 3;
          if (target === "conversion") return Math.max(1, Math.round(base * (0.95 + ((seed % 9) / 100))));
          if (target === "dwell") return Math.max(1, Math.round(base * (0.9 + ((seed % 6) / 100))));
          return Math.max(1, Math.round(base * r));
        })();
        setValues((prev) => ({ ...prev, [target]: next }));
        setFlip((prev) => ({ ...prev, [target]: a.flip === undefined ? true : !!a.flip }));
        setPanelAck(true);
      }
    });
    return () => off();
  }, []);

  const revenueDisplayTarget = flip.revenue ? values.revenue : stats.revenue;
  const revenueCount = useCountUp(revenueDisplayTarget, 1500);
  const visitorsCount = useCountUp(values.visitors, 1200);
  const conversionCount = useCountUp(values.conversion, 1000);
  const dwellCount = useCountUp(values.dwell, 900);
  const energyCount = useCountUp(values.energy, 1200);
  const wifiCount = useCountUp(values.wifi, 900);
  const revenueFrontText = useMemo(() => stats.revenue.toLocaleString(), [stats.revenue]);

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div
            className="transition-transform duration-500"
            style={{ transformStyle: "preserve-3d", transform: flip.revenue ? "rotateY(180deg)" : "rotateY(0deg)" }}
          >
            <div className="flex flex-col justify-center" style={{ backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">今日金额</div>
              <div className="mt-1 text-2xl font-semibold tracking-wider">¥ {revenueFrontText}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: "100%" }} />
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col justify-center" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">{labels.revenue}</div>
              <div className="mt-1 text-2xl font-semibold tracking-wider">¥ {revenueCount.toLocaleString()}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div className="transition-transform duration-500" style={{ transformStyle: "preserve-3d", transform: flip.visitors ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="flex flex-col justify-center" style={{ backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">今日来客</div>
              <div className="mt-1 text-2xl font-semibold tracking-wider">
                {stats.visitors.toLocaleString()} <span className="text-sm font-normal text-zinc-400">人</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-emerald-400">
                <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                环比 +4.2%
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col justify-center" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">{labels.visitors}</div>
              <div className="mt-1 text-2xl font-semibold tracking-wider">
                {visitorsCount.toLocaleString()} <span className="text-sm font-normal text-zinc-400">人</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-emerald-400">
                <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
                环比 +4.2%
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div className="transition-transform duration-500" style={{ transformStyle: "preserve-3d", transform: flip.conversion ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="flex items-center justify-between" style={{ backfaceVisibility: "hidden" }}>
              <div>
                <div className="text-xs text-zinc-400">转化率</div>
                <div className="mt-1 text-2xl font-semibold tracking-wider">{Math.round(stats.conversionRate)}%</div>
                <div className="mt-1 text-[10px] text-zinc-500">实时目标完成</div>
              </div>
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(#22d3ee ${stats.conversionRate * 3.6}deg, rgba(255,255,255,0.1) ${stats.conversionRate * 3.6}deg)` }} />
                <div className="absolute inset-1.5 rounded-full bg-[#0b1220]" />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-between" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div>
                <div className="text-xs text-zinc-400">{labels.conversion}</div>
                <div className="mt-1 text-2xl font-semibold tracking-wider">{Math.round(conversionCount)}%</div>
                <div className="mt-1 text-[10px] text-zinc-500">实时目标完成</div>
              </div>
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(#22d3ee ${Math.round(values.conversion) * 3.6}deg, rgba(255,255,255,0.1) ${Math.round(values.conversion) * 3.6}deg)` }} />
                <div className="absolute inset-1.5 rounded-full bg-[#0b1220]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 迁移过来的指标：平均停留 */}
      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div className="transition-transform duration-500" style={{ transformStyle: "preserve-3d", transform: flip.dwell ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="flex flex-col justify-center" style={{ backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">平均停留</div>
              <div className="mt-1 text-2xl font-semibold">{stats.dwellTimeAvgMin} <span className="text-xs font-normal text-zinc-500">min</span></div>
              <div className="mt-2 h-1 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, (stats.dwellTimeAvgMin / 60) * 100)}%` }} />
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col justify-center" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">{labels.dwell}</div>
              <div className="mt-1 text-2xl font-semibold">{Math.round(dwellCount)} <span className="text-xs font-normal text-zinc-500">min</span></div>
              <div className="mt-2 h-1 w-full rounded-full bg-white/10">
                <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.min(100, (Math.round(values.dwell) / 60) * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 迁移过来的指标：今日能耗 */}
      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div className="transition-transform duration-500" style={{ transformStyle: "preserve-3d", transform: flip.energy ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="flex flex-col justify-center" style={{ backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">今日能耗</div>
              <div className="mt-1 text-xl font-semibold">{stats.energyKwh.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-500">kWh</div>
            </div>
            <div className="absolute inset-0 flex flex-col justify-center" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">{labels.energy}</div>
              <div className="mt-1 text-xl font-semibold">{energyCount.toLocaleString()}</div>
              <div className="text-[10px] text-zinc-500">kWh</div>
            </div>
          </div>
        </div>
      </div>

      {/* 迁移过来的指标：WiFi终端 */}
      <div className="rounded-xl bg-white/5 p-4 backdrop-blur-xl ring-1 ring-white/10">
        <div className="relative" style={{ perspective: "800px" }}>
          <div className="transition-transform duration-500" style={{ transformStyle: "preserve-3d", transform: flip.wifi ? "rotateY(180deg)" : "rotateY(0deg)" }}>
            <div className="flex flex-col justify-center" style={{ backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">WiFi终端</div>
              <div className="mt-1 text-xl font-semibold">{stats.wifiConnections.toLocaleString()}</div>
              <div className="mt-2 flex items-end gap-0.5 h-3">
                {stats.salesPerMinute.slice(-10).map((v, i) => (
                  <div key={i} className="w-1.5 rounded-full bg-zinc-600" style={{ height: `${20 + (v % 80)}%` }} />
                ))}
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col justify-center" style={{ transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>
              <div className="text-xs text-zinc-400">{labels.wifi}</div>
              <div className="mt-1 text-xl font-semibold">{wifiCount.toLocaleString()}</div>
              <div className="mt-2 flex items-end gap-0.5 h-3">
                {stats.salesPerMinute.slice(-10).map((v, i) => (
                  <div key={i} className="w-1.5 rounded-full bg-zinc-600" style={{ height: `${20 + (v % 80)}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
