import ScaleScreen from "./_components/ScaleScreen";
import AssistantPanel from "./_components/AssistantPanel";
import DecisionCards from "./_components/DecisionCards";
import VisualClient from "./_components/VisualClient";
import MarketingStats from "./_components/MarketingStats";
import KeyMetrics from "./_components/KeyMetrics";
import MonthlyReportModal from "./_components/MonthlyReportModal";
import { mockStats } from "./mock";
import "./screen.css";

export default function SmartScreen() {
  return (
    <ScaleScreen width={1920} height={1080}>
      <div className="h-full w-full bg-linear-to-br from-[#08090c] via-[#0b1220] to-[#0c0f1a] text-zinc-100 flex flex-col p-6 gap-6 overflow-y-auto 2xl:overflow-hidden">
        
        <header className="flex justify-between items-center shrink-0 h-12">
           <div>
               <h1 className="text-2xl font-bold tracking-widest text-transparent bg-clip-text bg-linear-to-r from-cyan-400 to-violet-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.3)]">SMART CAMPUS</h1>
               <p className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Real-time Monitoring System</p>
           </div>
           <div className="flex items-center gap-4">
               <div className="text-xs text-zinc-400 font-mono">{new Date().toLocaleDateString()}</div>
               <div className="size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
           </div>
        </header>
  
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 2xl:grid-cols-12 gap-6 min-h-0">
        
        <section className="col-span-1 lg:col-span-7 2xl:col-span-5 flex flex-col gap-4 min-h-0">
            {/* 上半部分：AI 和 决策 并列 */}
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 min-h-[300px]">
                <div className="rounded-2xl bg-black/40 p-4 backdrop-blur-md ring-1 ring-white/10 flex flex-col overflow-hidden shadow-lg min-w-[280px]">
                    <div className="flex items-center gap-2 shrink-0 mb-3">
                        <div className="relative">
                            <div className="size-8 rounded-full bg-linear-to-br from-cyan-400 to-violet-600 shadow-[0_0_20px_-5px_rgba(99,102,241,0.6)]" />
                            <div className="absolute inset-0 animate-aura rounded-full ring-2 ring-cyan-400/40" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold tracking-wide">智能助手</h2>
                            <p className="text-[10px] text-zinc-400">AI Assistant / Voice</p>
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden relative">
                        <div className="absolute inset-0 overflow-y-auto overflow-x-hidden no-scrollbar mask-image-b">
                            <AssistantPanel />
                        </div>
                    </div>
                    <div className="mt-2 shrink-0" />
                </div>

                <div className="rounded-2xl bg-black/40 p-1 backdrop-blur-md ring-1 ring-white/10 flex flex-col overflow-hidden shadow-lg min-w-[280px]">
                    <div className="px-3 py-3 border-b border-white/5 flex justify-between items-center shrink-0">
                        <span className="text-xs text-zinc-400 font-medium">智能决策</span>
                        <span className="flex size-1.5 rounded-full bg-amber-500 animate-pulse" />
                    </div>
                    <div className="flex-1 overflow-hidden relative p-2">
                        <div className="absolute inset-0 overflow-y-auto no-scrollbar">
                            <DecisionCards />
                        </div>
                    </div>
                </div>
            </div>

            <div className="h-auto xl:h-[40%] min-h-[250px] rounded-2xl bg-black/40 p-4 backdrop-blur-md ring-1 ring-white/10 overflow-y-auto no-scrollbar shadow-lg">
                <KeyMetrics stats={mockStats} />
            </div>
        </section>

        <section className="col-span-1 lg:col-span-5 2xl:col-span-7 flex flex-col gap-6 min-h-0">
            <div className="relative rounded-3xl border border-white/5 bg-black/20 backdrop-blur-sm overflow-hidden shadow-2xl min-h-[260px] lg:h-[420px] 2xl:flex-1 2xl:min-h-[300px]">
               <VisualClient />
               <div className="absolute top-0 left-0 p-4 pointer-events-none">
                  <div className="text-[10px] text-white/20 font-mono tracking-widest">FLOOR PLAN VIEW // LIVE</div>
               </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-5 shadow-lg flex flex-col overflow-visible">
               <div className="flex items-center gap-2 mb-4 shrink-0">
                  <div className="size-1 rounded-full bg-cyan-400" />
                  <span className="text-xs text-zinc-400 tracking-wider">DETAILED ANALYTICS</span>
                  <div className="h-px flex-1 bg-white/5" />
               </div>
               <div className="min-h-0">
                  <MarketingStats stats={mockStats} />
               </div>
            </div>
        </section>

      </main>
      <MonthlyReportModal />
      </div>
    </ScaleScreen>
  );


}
