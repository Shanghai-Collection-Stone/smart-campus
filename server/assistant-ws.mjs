import { createServer } from "http";
import next from "next";
import { Server as IOServer } from "socket.io";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { SystemMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";

/**
 * 启动同端口 Next.js + Socket.IO 服务
 * @returns {Promise<void>}
 * @keyword-en startUnifiedServer, nextCustomServer, samePortSocket
 */
async function startServer() {
  const dev = process.env.NODE_ENV !== "production";
  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  const loadLocalEnv = () => {
    const files = [".env.local", ".env"].map((f) => join(process.cwd(), f));
    for (const p of files) {
      if (!existsSync(p)) continue;
      const txt = readFileSync(p, "utf8");
      const lines = txt.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(m[1] in process.env)) process.env[m[1]] = v;
      }
    }
  };
  loadLocalEnv();

  const port = Number(process.env.PORT || 3000);
  const httpServer = createServer((req, res) => handle(req, res));


  const io = new IOServer(httpServer, {
    path: "/api/socket",
    cors: { origin: true, methods: ["GET", "POST"] },
  });

  const decisionSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    priority: z.enum(["low", "medium", "high"]),
  });
  const decisionIdSchema = z.object({ id: z.string() });
  const decisionExecuteSchema = z.object({ id: z.string().optional(), index: z.number().int().min(1).optional() });
  const decisionsStatusStore = new Map();
  const snapshotStatuses = () => {
    const obj = {};
    decisionsStatusStore.forEach((v, k) => { obj[k] = v; });
    return obj;
  };
  const decisionsStore = [];

  const panelWaiters = new Map();
  const emitPanelAction = (action) => new Promise((resolve) => {
    const id = `panel-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    panelWaiters.set(id, resolve);
    io.to("panel").emit("panel:action", { id, action });
  });

  const socketHistories = new Map();

  const tools = [
    new DynamicStructuredTool({
      name: "executeDecision",
      description: [
        "执行智能决策（按 id 或索引 index）。",
        "当用户说“执行智能决策第N条/第N项/编号N/序号N”，调用本工具触发前端执行。",
        "若缺少 id 与 index，应返回 {ok:false, reason:'need_index', count}，由 AI 继续向用户询问第几条。",
      ].join(" "),
      schema: z.object({ id: z.string().optional(), index: z.number().int().min(1).optional() }),
      func: async ({ id, index }) => {
        if (!id && !index) {
          return JSON.stringify({ ok: false, reason: "need_index", count: decisionsStore.length });
        }
        const payload = {};
        if (id) payload.id = id;
        if (typeof index === "number") payload.index = index;
        io.to("decision").emit("decision:execute", payload);
        return JSON.stringify({ ok: true, executed: payload });
      },
    }),
    new DynamicStructuredTool({
      name: "updateMetricCard",
      description: [
        "切换左侧指标卡片的标签与数值，并可触发翻转显示。",
        "目标映射: revenue=今日金额, visitors=今日来客, conversion=转化率, dwell=平均停留, energy=今日能耗, wifi=WiFi终端。",
        "示例: 将“今日金额”改为“昨日金额”→ {target:'revenue', label:'昨日金额', flip:true}。",
        "当用户说“把今日金额切换为昨日金额/昨天金额”，请调用本工具。",
        "请直接调用此工具，不要解释；等待前端完成后返回简短确认。",
      ].join(" "),
      schema: z.object({
        target: z.enum(["revenue", "visitors", "conversion", "dwell", "energy", "wifi"]),
        label: z.string().optional(),
        value: z.number().optional(),
        flip: z.boolean().optional(),
      }),
      func: async ({ target, label, value, flip }) => {
        const action = { kind: "metric:set", target, label, value, flip: flip ?? true };
        const res = await emitPanelAction(action);
        return JSON.stringify({ ok: true, ack: res });
      },
    }),
    new DynamicStructuredTool({
      name: "updateMetricByLabel",
      description: [
        "通过中文标签指定要修改的左侧指标卡，例如'今日来客'、'今日金额'、'WiFi终端'等。",
        "示例: 将'今日来客'改为'昨日来客'→ {oldLabel:'今日来客', newLabel:'昨日来客', flip:true}；也可附带数值 {value:1234}。",
        "当前端无法识别该标签时，会返回不可用信息，助手需根据返回提示用户。",
      ].join(" "),
      schema: z.object({ oldLabel: z.string(), newLabel: z.string().optional(), value: z.number().optional(), flip: z.boolean().optional() }),
      func: async ({ oldLabel, newLabel, value, flip }) => {
        const action = { kind: "metric:updateByLabel", oldLabel, newLabel, value, flip };
        const res = await emitPanelAction(action);
        return JSON.stringify({ ok: true, ack: res });
      },
    }),
    new DynamicStructuredTool({
      name: "setTrendType",
      description: [
        "切换右侧趋势类型为'销售趋势'或'人数趋势'。",
        "示例: 将销售趋势改为人数趋势→ {to:'people'}。",
        "当用户说“右侧改为人数趋势”或“切换趋势为销售/人数”，请调用本工具。",
        "请直接调用此工具，不要解释；等待前端完成后返回简短确认。",
      ].join(" "),
      schema: z.object({ to: z.enum(["sales", "people"]) }),
      func: async ({ to }) => {
        const action = { kind: "trend:set", target: "sales", to };
        const res = await emitPanelAction(action);
        return JSON.stringify({ ok: true, ack: res });
      },
    }),
    new DynamicStructuredTool({
      name: "openMonthlyReport",
      description: [
        "弹出月度详细报表弹窗，支持八月与九月。",
        "示例: 展示八月份报表→ {month:'八月'}；展示九月份报表→ {month:'九月'}。",
        "也可传 8/9 或 08/09、August/September。",
        "请直接调用本工具，不要解释；等待前端完成后返回简短确认。",
      ].join(" "),
      schema: z.object({ month: z.string() }),
      func: async ({ month }) => {
        const normalize = (m) => {
          const s = String(m || "").trim().toLowerCase();
          if (s === "8" || s === "08" || s.includes("八") || s.includes("aug")) return "2025-08";
          if (s === "9" || s === "09" || s.includes("九") || s.includes("sep")) return "2025-09";
          return "";
        };
        const mk = normalize(month);
        if (!mk) return JSON.stringify({ ok: false, message: "unknown_month" });
        const action = { kind: "report:open", month: mk };
        const res = await emitPanelAction(action);
        return JSON.stringify({ ok: true, ack: res });
      },
    }),
    new DynamicStructuredTool({
      name: "closeMonthlyReport",
      description: [
        "关闭月度详细报表弹窗。",
        "当用户说'关闭报表'、'收起报表'、'隐藏月度报表'时，请调用本工具。",
        "请直接调用本工具，不要解释；等待前端完成后返回简短确认。",
      ].join(" "),
      schema: z.object({}),
      func: async () => {
        const action = { kind: "report:close" };
        const res = await emitPanelAction(action);
        return JSON.stringify({ ok: true, ack: res });
      },
    }),
    new DynamicStructuredTool({
      name: "getMenuGuide",
      description: [
        "返回可操作菜单与示例，用于语音或文本查看可用指令。",
        "包含左侧指标卡标签与常用同义词、右侧趋势类型、示例句式。",
      ].join(" "),
      schema: z.object({}),
      func: async () => {
        const menu = {
          leftCards: [
            { target: "revenue", canonical: "今日金额", synonyms: ["金额", "营收", "交易", "收入", "销售额"] },
            { target: "visitors", canonical: "今日来客", synonyms: ["来客", "人流", "人数", "访客"] },
            { target: "conversion", canonical: "转化率", synonyms: ["转化", "成交", "转化率"] },
            { target: "dwell", canonical: "平均停留", synonyms: ["停留", "停留时长", "平均停留"] },
            { target: "energy", canonical: "今日能耗", synonyms: ["能耗", "电量", "用电"] },
            { target: "wifi", canonical: "WiFi终端", synonyms: ["WiFi", "无线", "终端"] },
          ],
          trend: ["销售趋势", "人数趋势"],
          modals: ["月度详细报表弹窗"],
          examples: [
            "把今日金额改为昨日金额",
            "将今日来客改成昨日来客",
            "右侧改为人数趋势",
            "展示八月份报表",
            "展示九月份报表",
            "关闭报表",
          ],
        };
        return JSON.stringify({ ok: true, menu });
      },
    }),
    new DynamicStructuredTool({
      name: "suggestMetricCandidates",
      description: [
        "根据用户的模糊语音文本返回可能的左侧指标候选项以供确认。",
        "当识别到的文本可能有误时，先调用本工具获取候选，再询问用户是否指的是其中之一。",
      ].join(" "),
      schema: z.object({ phrase: z.string() }),
      func: async ({ phrase }) => {
        const groups = [
          { target: "revenue", canonical: "今日金额", labels: ["金额", "营收", "交易", "收入", "销售额"] },
          { target: "visitors", canonical: "今日来客", labels: ["来客", "人流", "人数", "访客"] },
          { target: "conversion", canonical: "转化率", labels: ["转化", "成交", "转化率"] },
          { target: "dwell", canonical: "平均停留", labels: ["停留", "停留时长", "平均停留"] },
          { target: "energy", canonical: "今日能耗", labels: ["能耗", "电量", "用电"] },
          { target: "wifi", canonical: "WiFi终端", labels: ["WiFi", "无线", "终端"] },
        ];
        const s = String(phrase || "").trim().toLowerCase();
        const scoreOf = (kw) => {
          const a = s;
          const b = String(kw || "").toLowerCase();
          if (!a || !b) return 0;
          let score = 0;
          if (a.includes(b) || b.includes(a)) score += 0.7;
          const setA = new Set(a);
          const setB = new Set(b);
          let inter = 0; setA.forEach((ch) => { if (setB.has(ch)) inter += 1; });
          const union = setA.size + setB.size - inter;
          const jaccard = union > 0 ? inter / union : 0;
          score += jaccard * 0.5;
          return Math.min(1, score);
        };
        const candidates = groups
          .map((g) => {
            const scores = [g.canonical, ...g.labels].map((l) => scoreOf(l));
            const score = Math.max(...scores);
            return { target: g.target, label: g.canonical, score, exampleLabels: g.labels.slice(0, 3) };
          })
          .filter((c) => c.score > 0.2)
          .sort((a, b) => b.score - a.score);
        return JSON.stringify({ ok: true, candidates });
      },
    }),
  ];

  const systemPrompt = [
    "你是运营数据助手，回答简短高效；凡是界面操作或展示调整，必须调用工具并等待确认。",
    "工具: executeDecision(执行智能决策)、updateMetricCard(按目标键切换左侧指标卡片)、updateMetricByLabel(按中文标签切换左侧指标卡片)、setTrendType(右侧趋势切换)、openMonthlyReport(弹出月度报表)、closeMonthlyReport(关闭月度报表)、getMenuGuide(返回菜单说明)、suggestMetricCandidates(模糊文本建议候选)。",
    "语音识别可能有误：当用户请求不清晰或标签不匹配时，先调用 suggestMetricCandidates 返回候选，向用户确认“是否指的是：A 或 B ？”；得到明确确认后再调用对应更新工具。",
    "示例: '执行智能决策第2条'→ executeDecision({index:2});",
    "示例: 未说明序号时，先回复询问“请问要执行第几条智能决策？”；得到用户明确后再调用 executeDecision({index:N})。",
    "示例: '把今日金额改成昨日金额'→ updateMetricCard({target:'revenue', label:'昨日金额', flip:true});",
    "示例: '把今日来客改为昨日来客'→ updateMetricByLabel({oldLabel:'今日来客', newLabel:'昨日来客', flip:true});",
    "示例: '右侧改为人数趋势'→ setTrendType({to:'people'});",
    "示例: '展示八月份报表'或'打开九月份报表'→ openMonthlyReport({month:'八月'}或{month:'九月'});",
    "示例: '关闭报表'、'收起月度报表'→ closeMonthlyReport({});",
    "用户说“菜单/不会用/怎么操作”时→ 调用 getMenuGuide() 并简要朗读关键项。",
    "收到面板确认后再回复“已切换”或根据失败信息提示用户，不要建议手动操作。",
  ].join(" ");

  const env = {
    key: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || "0.2"),
    timeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || "120000"),
  };
  const nlsUrl = process.env.ALIYUN_NLS_URL || "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";
  const nlsAppKey = process.env.ALIYUN_NLS_APPKEY || "";
  const akId = process.env.ALIYUN_AK_ID || "";
  const akSecret = process.env.ALIYUN_AK_SECRET || "";
  const srLogEnabled = process.env.SR_LOG === "1";
  let nlsTokenCache = { id: "", expireTime: 0 };
  const refreshNlsToken = async () => {
    if (!akId || !akSecret) return;
    let RPCClient;
    try {
      const mod = await import("@alicloud/pop-core");
      RPCClient = mod && mod.RPCClient ? mod.RPCClient : null;
    } catch {
      RPCClient = null;
    }
    if (!RPCClient) return;
    const client = new RPCClient({ accessKeyId: akId, accessKeySecret: akSecret, endpoint: "http://nls-meta.cn-shanghai.aliyuncs.com", apiVersion: "2019-02-28" });
    let res;
    try { res = await client.request("CreateToken", {}, { method: "POST" }); } catch { res = null; }
    const tokenObj = res && res.Token ? res.Token : null;
    const id = tokenObj && typeof tokenObj.Id === "string" ? tokenObj.Id : "";
    const expireTime = tokenObj && typeof tokenObj.ExpireTime === "number" ? tokenObj.ExpireTime : 0;
    if (id && expireTime) { nlsTokenCache = { id, expireTime }; }
  };
  const ensureNlsToken = async () => {
    const now = Math.floor(Date.now() / 1000);
    const need = !nlsTokenCache.id || nlsTokenCache.expireTime <= now + 60;
    if (need) await refreshNlsToken();
    return nlsTokenCache.id;
  };
  try { await refreshNlsToken(); } catch {}
  const baseURL = env.baseURL;
  const model = env.key
    ? new ChatOpenAI({
        model: env.model,
        temperature: env.temperature,
        maxRetries: 0,
        apiKey: env.key,
        configuration: { baseURL, timeout: env.timeoutMs },
      })
    : null;

  console.log("[assistant] llm config", { baseURL, model: env.model, temperature: env.temperature, keyLen: env.key ? env.key.length : 0 });

  
  const formatError = (e) => {
    const obj = {};
    obj.name = e && e.name ? e.name : undefined;
    obj.message = e && e.message ? e.message : String(e);
    obj.stack = e && e.stack ? e.stack : undefined;
    const resp = e && e.response ? e.response : undefined;
    if (resp) {
      obj.status = resp.status;
      obj.statusText = resp.statusText;
    }
    const body = e && e.body ? e.body : e && e.response && e.response.body ? e.response.body : undefined;
    if (body) obj.body = typeof body === "string" ? body : JSON.stringify(body);
    return obj;
  };
  
  const runAgent = async (messages) => {
    if (!model) {
      const last = messages[messages.length - 1];
      const text = last && last.content ? (typeof last.content === "string" ? last.content : JSON.stringify(last.content)) : "";
      return text;
    }
    const llm = model.bindTools(tools);
    const started = Date.now();
    console.log("[assistant] llm.invoke start", { elapsed: 0 });
    for (let i = 0; i < 6; i++) {
      let ai;
      try {
        ai = await llm.invoke(messages);
      } catch (e) {
        console.error("[assistant] llm.invoke error", formatError(e));
        throw e;
      }
      const now = Date.now();
      console.log("[assistant] llm.invoke ok", { elapsed: now - started });
      // 将包含 tool_calls 的 AI 消息加入上下文，后续才能合法附加 tool 响应
      messages.push(ai);
      const calls = Array.isArray(ai?.tool_calls) ? ai.tool_calls : [];
      if (calls.length === 0) {
        const content = ai?.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
        return String(content ?? "");
      }
      for (const c of calls) {
        const name = c?.name || c?.type || "";
        const tool = tools.find((t) => t.name === name);
        if (!tool) continue;
        const args = c?.input ?? c?.args ?? {};
        let out = "";
        try {
          out = await tool.invoke(args);
        } catch (e) {
          console.error("[assistant] tool error", { name, args, error: formatError(e) });
          out = `ToolError: ${e && e.message ? e.message : String(e)}`;
        }
        messages.push(new ToolMessage({ content: typeof out === "string" ? out : JSON.stringify(out), tool_call_id: c?.id || name }));
      }
    }
    return "完成";
  };

  io.on("connection", (socket) => {
    socket.emit("status", { status: "ready" });
    socket.on("start", () => {
      socket.emit("status", { status: "ready" });
    });

    const sanitizeVoiceText = (text) => String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[，。！？、,.!?;:]+/g, "")
      .replace(/[，。！？、,.!?;:]+$/g, "");

    const normalizeVoiceKey = (text) => sanitizeVoiceText(text).replace(/[\s，。！？、,.!?;:]+/g, "");

    let voiceChain = Promise.resolve();
    let lastVoiceKey = "";
    let lastVoiceAt = 0;

    const processUserText = async (text, meta = {}) => {
      const raw = typeof text === "string" ? text : "";
      const content = meta && meta.source === "voice" ? sanitizeVoiceText(raw) : raw.trim();
      if (!content) {
        if (meta && meta.source === "voice") return;
        socket.emit("assistant_message", { message: "请输入查询文本" });
        return;
      }

      socket.emit("status", { status: "working", ...meta });
      try {
        const prev = socketHistories.get(socket.id) || [];
        const msgs = [new SystemMessage(systemPrompt), ...prev, new HumanMessage(content)];
        let reply;
        try {
          reply = await runAgent(msgs);
        } catch (e) {
          console.warn("[assistant] agent failed");
          throw e;
        }
        const nextHistory = msgs.filter((m) => !(m instanceof SystemMessage));
        socketHistories.set(socket.id, nextHistory);
        socket.emit("assistant_message", { message: reply });
        socket.emit("status", { status: "ready" });
      } catch (e) {
        const info = formatError(e);
        console.error("[assistant] user_input error", info);
        socket.emit("assistant_error", { message: info.message, detail: info });
        socket.emit("assistant_message", { message: "服务错误" });
        socket.emit("status", { status: "ready" });
      }
    };

    const nlsSessions = new Map();

    let nlsOpening = false;

    const safeJsonParse = (input) => {
      if (typeof input !== "string") return null;
      try { return JSON.parse(input); } catch { return null; }
    };

    const normalizeAliNlsError = (msg) => {
      const direct = typeof msg === "string" ? safeJsonParse(msg) : (msg && typeof msg === "object" ? msg : null);
      const wrappedMsg = direct && typeof direct.message === "string" ? safeJsonParse(direct.message) : null;
      const obj = wrappedMsg || direct;

      const header = obj && typeof obj.header === "object" && obj.header !== null ? obj.header : null;
      const statusText = header && typeof header.status_text === "string" ? header.status_text : "";
      const status = header && typeof header.status === "number" ? header.status : null;
      const taskId = header && typeof header.task_id === "string" ? header.task_id : "";
      const messageId = header && typeof header.message_id === "string" ? header.message_id : "";
      const name = header && typeof header.name === "string" ? header.name : "";

      const raw = typeof msg === "string" ? msg : (msg ? JSON.stringify(msg) : "");
      const message = statusText || (name ? `Task ${name}` : "failed");

      return {
        message,
        detail: { status, statusText: statusText || null, taskId: taskId || null, messageId: messageId || null, name: name || null, raw: raw || null },
      };
    };

    const closeAliSession = async () => {
      const n = nlsSessions.get(socket.id);
      if (!n || !n.st) return;
      try { await n.st.close(); } catch {}
      try { n.st.shutdown?.(); } catch {}
      nlsSessions.delete(socket.id);
    };

  const openAliNlsSession = async () => {
    if (!nlsAppKey) { socket.emit("sr:ali:error", { message: "missing_appkey" }); return null; }
    let SpeechTranscriptionCtor = null;
    try {
      const mod = await import("alibabacloud-nls");
      if (mod && typeof mod.SpeechTranscription === "function") SpeechTranscriptionCtor = mod.SpeechTranscription;
      const d = mod && mod.default ? mod.default : null;
      if (!SpeechTranscriptionCtor && d && typeof d.SpeechTranscription === "function") SpeechTranscriptionCtor = d.SpeechTranscription;
    } catch {}
    if (!SpeechTranscriptionCtor) {
      try {
        const m = await import("module");
        const req = m && typeof m.createRequire === "function" ? m.createRequire(import.meta.url) : null;
        const cjs = req ? req("alibabacloud-nls") : null;
        if (cjs && typeof cjs.SpeechTranscription === "function") SpeechTranscriptionCtor = cjs.SpeechTranscription;
      } catch {}
    }
    if (!SpeechTranscriptionCtor) { socket.emit("sr:ali:error", { message: "sdk_not_installed" }); return null; }
    const tokenValue = await ensureNlsToken();
    if (!tokenValue) { socket.emit("sr:ali:error", { message: "token_unavailable" }); return null; }
    const st = new SpeechTranscriptionCtor({ url: nlsUrl, appkey: nlsAppKey, token: tokenValue });
      st.on("started", () => {});
      st.on("changed", (msg) => {
        try {
          const o = typeof msg === "string" ? JSON.parse(msg) : msg;
          const header = o && typeof o.header === "object" && o.header !== null ? o.header : null;
          const name = header && typeof header.name === "string" ? header.name : "";
          const t = o && o.payload && typeof o.payload.result === "string" ? o.payload.result : (o && typeof o.result === "string" ? o.result : (o && typeof o.text === "string" ? o.text : ""));
          if (!t) return;

          if (srLogEnabled) {
            try {
              const payload = o && typeof o.payload === "object" && o.payload !== null ? o.payload : null;
              const idx = payload && typeof payload.index === "number" ? payload.index : null;
              const time = payload && typeof payload.time === "number" ? payload.time : null;
              const beginTime = payload && typeof payload.begin_time === "number" ? payload.begin_time : null;
              console.log("[sr:ali:nls]", { evt: name || "changed", idx, time, beginTime, text: t });
            } catch {}
          }

          const isSentenceEnd = name === "SentenceEnd";
          const isInterim = !name || name === "TranscriptionResultChanged" || name === "RecognitionResultChanged";

          if (isSentenceEnd) {
            socket.emit("sr:ali:final", { text: t });
            const cleaned = sanitizeVoiceText(t);
            const key = normalizeVoiceKey(cleaned);
            const now = Date.now();
            if (key && key.length > 1) {
              if (key !== lastVoiceKey || now - lastVoiceAt > 1200) {
                lastVoiceKey = key;
                lastVoiceAt = now;
                voiceChain = voiceChain
                  .then(() => processUserText(cleaned, { source: "voice" }))
                  .catch(() => {});
              }
            }
            return;
          }

          if (isInterim) socket.emit("sr:ali:interim", { text: t });
        } catch {}
      });
      st.on("completed", (msg) => {
        try {
          const o = typeof msg === "string" ? JSON.parse(msg) : msg;
          if (srLogEnabled) {
            try {
              const header = o && typeof o.header === "object" && o.header !== null ? o.header : null;
              const name = header && typeof header.name === "string" ? header.name : "";
              console.log("[sr:ali:nls]", { evt: name || "completed" });
            } catch {}
          }
          const t = o && o.payload && typeof o.payload.result === "string" ? o.payload.result : (o && typeof o.result === "string" ? o.result : (o && typeof o.text === "string" ? o.text : ""));
          if (t) {
            if (srLogEnabled) {
              try { console.log("[sr:ali:nls]", { evt: "completed.result", text: t }); } catch {}
            }
            socket.emit("sr:ali:final", { text: t });
            const cleaned = sanitizeVoiceText(t);
            const key = normalizeVoiceKey(cleaned);
            const now = Date.now();
            if (key && key.length > 1) {
              if (key !== lastVoiceKey || now - lastVoiceAt > 1200) {
                lastVoiceKey = key;
                lastVoiceAt = now;
                voiceChain = voiceChain
                  .then(() => processUserText(cleaned, { source: "voice" }))
                  .catch(() => {});
              }
            }
          }
        } catch {}
      });
    st.on("failed", async (msg) => {
      const info = normalizeAliNlsError(msg);
      socket.emit("sr:ali:error", info);
      await closeAliSession();
    });
    st.on("closed", async () => {
      socket.emit("sr:ali:closed", { ok: true });
      await closeAliSession();
    });
      const startParams = st.defaultStartParams();
      if (startParams && typeof startParams === "object") {
        startParams.format = "pcm";
        startParams.sample_rate = 16000;
        startParams.max_sentence_silence = 2000;
        startParams.enable_intermediate_result = true;
        startParams.enable_punctuation_prediction = true;
        startParams.enable_inverse_text_normalization = true;
        const vocabId = process.env.ALIYUN_NLS_VOCAB_ID || "";
        const customizationId = process.env.ALIYUN_NLS_CUSTOMIZATION_ID || "";
        if (vocabId) startParams.vocabulary_id = vocabId;
        if (customizationId) startParams.customization_id = customizationId;
      }
      try { await st.start(startParams, true, 6000); } catch (e) {
        socket.emit("sr:ali:error", { message: e && e.message ? e.message : "start_error" });
        try { await st.close(); } catch {}
        try { st.shutdown?.(); } catch {}
        return null;
      }
      nlsSessions.set(socket.id, { st });
      return { st };
    };
    socket.on("sr:ali:start", async () => {
      const existsNls = nlsSessions.get(socket.id);
      if (existsNls && existsNls.st) return;
      if (!nlsAppKey) { socket.emit("sr:ali:error", { message: "missing_appkey" }); return; }
      if (nlsOpening) return;
      nlsOpening = true;
      try { await openAliNlsSession(); } finally { nlsOpening = false; }
    });
    socket.on("sr:ali:audio", (buf) => {
      const n = nlsSessions.get(socket.id);
      if (!n || !n.st) {
        if (!nlsOpening) {
          nlsOpening = true;
          Promise.resolve(openAliNlsSession()).finally(() => { nlsOpening = false; });
        }
        return;
      }
      try {
        const b = Buffer.isBuffer(buf) ? buf : (buf instanceof ArrayBuffer ? Buffer.from(new Uint8Array(buf)) : Buffer.from(buf));
        n.st.sendAudio(b);
      } catch {}
    });
    socket.on("sr:ali:stop", async () => {
      await closeAliSession();
    });

    socket.on("decision:join", () => {
      socket.join("decision");
    });
    socket.on("decision:list", () => {
      socket.emit("decision:update", { decisions: decisionsStore, statuses: snapshotStatuses() });
    });
    socket.on("decision:push", (payload) => {
      try {
        const d = decisionSchema.parse(payload);
        const exists = decisionsStore.findIndex((x) => x.id === d.id);
        if (exists >= 0) decisionsStore[exists] = d; else decisionsStore.push(d);
        if (!decisionsStatusStore.has(d.id)) decisionsStatusStore.set(d.id, { status: "pending" });
        io.to("decision").emit("decision:update", { decisions: decisionsStore, statuses: snapshotStatuses() });
        io.emit("assistant_message", {
          message: "根据当前智能分析，C区人流量不足，建议采用优惠券派发与重点引导，提高右上角客流。",
        });
      } catch (e) {
        socket.emit("decision:error", { message: e?.message || "invalid decision" });
      }
    });
    socket.on("decision:executed", (payload) => {
      io.to("decision").emit("decision:executed", payload);
      try {
        const ok = decisionIdSchema.safeParse(payload);
        if (ok.success) {
          const startAt = Date.now();
          decisionsStatusStore.set(ok.data.id, { status: "executing", startAt });
          io.to("decision").emit("decision:status", { id: ok.data.id, status: "executing", startAt });
        }
      } catch {}
    });
    socket.on("panel:join", () => {
      socket.join("panel");
    });
    socket.on("decision:defer", (payload) => {
      try {
        const ok = decisionIdSchema.safeParse(payload);
        if (!ok.success) return;
        io.to("decision").emit("decision:deferred", { id: ok.data.id });
        decisionsStatusStore.set(ok.data.id, { status: "deferred" });
        io.to("decision").emit("decision:status", { id: ok.data.id, status: "deferred" });
      } catch {}
    });
    socket.on("decision:close", (payload) => {
      try {
        const ok = decisionIdSchema.safeParse(payload);
        if (!ok.success) return;
        io.to("decision").emit("decision:closed", { id: ok.data.id });
        decisionsStatusStore.set(ok.data.id, { status: "closed" });
        io.to("decision").emit("decision:status", { id: ok.data.id, status: "closed" });
      } catch {}
    });
    socket.on("decision:execute", (payload) => {
      try {
        const ok = decisionExecuteSchema.safeParse(payload);
        if (!ok.success || (!ok.data.id && !ok.data.index)) {
          io.to("decision").emit("decision:execute:ask", { reason: "need_index", count: decisionsStore.length });
          return;
        }
        io.to("decision").emit("decision:execute", ok.data);
      } catch {}
    });
    socket.on("panel:join", () => {
      socket.join("panel");
    });
    socket.on("panel:done", (payload) => {
      try {
        const id = payload && typeof payload.id === "string" ? payload.id : "";
        const fn = panelWaiters.get(id);
        if (fn) { panelWaiters.delete(id); fn(payload); }
      } catch {}
    });
    socket.on("decision:estimate", (payload) => {
      try {
        const id = payload && typeof payload.id === "string" ? payload.id : "";
        const inc = 30 + Math.floor(Math.random() * 31);
        socket.emit("decision:estimate", { id, inc });
      } catch {}
    });
    socket.on("user_input", async (payload) => {
      const text = typeof payload?.text === "string" ? payload.text : "";
      await processUserText(text, { source: "text" });
    });
    socketHistories.set(socket.id, socketHistories.get(socket.id) || []);
    socket.on("disconnect", async () => { socketHistories.delete(socket.id); await closeAliSession(); });
  });

  const listenWithFallback = (srv, initialPort, maxTries = 5) => new Promise((resolve, reject) => {
    let p = initialPort;
    const tryListen = () => {
      srv.once("error", (err) => {
        if (err && err.code === "EADDRINUSE" && maxTries > 0) {
          maxTries -= 1;
          p += 1;
          srv.listen(p);
        } else {
          reject(err);
        }
      });
      srv.once("listening", () => resolve(p));
      srv.listen(p);
    };
    tryListen();
  });

  try {
    const actualPort = await listenWithFallback(httpServer, port, 5);
    console.log(`Unified server ready on http://localhost:${actualPort}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}



startServer();
