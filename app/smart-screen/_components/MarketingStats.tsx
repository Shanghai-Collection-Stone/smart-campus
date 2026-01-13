 "use client";
import { Stat } from "../mock";
import { useEffect, useMemo, useState } from "react";
import { onPanelAction, type PanelAction } from "./panelBus";

export default function MarketingStats({ stats }: { stats: Stat }) {
  const [trendLabel, setTrendLabel] = useState("销售趋势");
  const [trendType, setTrendType] = useState<"sales" | "people">("sales");

  useEffect(() => {
    const off = onPanelAction((a: PanelAction) => {
      if (a.kind === "trend:set") {
        setTrendType(a.to);
        setTrendLabel(a.to === "people" ? "人数趋势" : "销售趋势");
      }
    });
    return () => off();
  }, []);

  const bars = useMemo(() => {
    const src = stats.salesPerMinute.slice(-20);
    if (trendType === "sales") return src;
    return src.map((v) => Math.min(100, Math.round(v * 3)));
  }, [stats.salesPerMinute, trendType]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-6">
      <div className="col-span-1 rounded-xl bg-black/30 p-6 ring-1 ring-white/10 flex flex-col justify-center">
        <div className="text-xs text-zinc-400">热门区域 Top3</div>
        <div className="mt-4 grid gap-4">
          {stats.hotZones.map((z, i) => (
            <div key={z.name} className="flex items-center gap-3">
              <div className="w-4 text-xs text-zinc-500">0{i + 1}</div>
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-300">{z.name}</span>
                    <span className="text-zinc-400">{z.value}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-amber-400 to-rose-500"
                    style={{ width: `${Math.min(100, z.value)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col-span-1 rounded-xl bg-black/30 p-6 ring-1 ring-white/10 flex flex-col justify-center">
        <div className="text-xs text-zinc-400">热门活动 Top3</div>
        <div className="mt-4 grid gap-4">
          {stats.hotEvents.map((z, i) => (
            <div key={z.name} className="flex items-center gap-3">
              <div className="w-4 text-xs text-zinc-500">0{i + 1}</div>
              <div className="flex-1">
                <div className="flex justify-between text-xs mb-1">
                    <span className="text-zinc-300">{z.name}</span>
                    <span className="text-zinc-400">{z.value}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-linear-to-r from-cyan-400 to-violet-500"
                    style={{ width: `${Math.min(100, z.value)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 合并与重组剩余指标 */}
      <div className="col-span-1 grid grid-cols-2 gap-4">
         <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10 flex flex-col justify-between">
          <div className="text-xs text-zinc-400">场馆占用</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-400">{Math.round(stats.occupancyRate)}%</div>
          <div className="text-[10px] text-zinc-500">舒适</div>
        </div>
        <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10 flex flex-col justify-between">
          <div className="text-xs text-zinc-400">设备在线</div>
          <div className="mt-2 text-2xl font-semibold text-blue-400">{Math.round(stats.deviceOnlineRate)}%</div>
          <div className="text-[10px] text-zinc-500">运行正常</div>
        </div>
        <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10 flex flex-col justify-between">
          <div className="text-xs text-zinc-400">优惠券核销</div>
          <div className="mt-2 text-2xl font-semibold text-amber-400">{Math.round(stats.couponRedemptionRate)}%</div>
          <div className="text-[10px] text-zinc-500">转化率良好</div>
        </div>
        <div className="rounded-xl bg-black/30 p-5 ring-1 ring-white/10 flex flex-col justify-between">
          <div className="text-xs text-zinc-400">AR互动</div>
          <div className="mt-2 text-2xl font-semibold text-violet-400">{Math.round(stats.arEngagementRate)}%</div>
          <div className="text-[10px] text-zinc-500">体验人次 +12%</div>
        </div>
      </div>

      <div className="col-span-1 rounded-xl bg-black/30 p-5 ring-1 ring-white/10 flex flex-col justify-center">
          <div className="text-xs text-zinc-400">{trendLabel}</div>
          <div className="mt-4 flex items-end gap-1 h-24 justify-between">
            {bars.map((v, i) => (
              <div
                key={i}
                className="w-2 rounded-t-sm bg-linear-to-t from-amber-500/20 to-amber-400"
                style={{ height: `${v}%` }}
              />
            ))}
          </div>
      </div>
    </div>
  );
}
