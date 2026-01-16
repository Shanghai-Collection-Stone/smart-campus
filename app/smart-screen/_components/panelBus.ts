"use client";

export type MetricKey =
  | "revenue"
  | "visitors"
  | "conversion"
  | "dwell"
  | "energy"
  | "wifi";

export type PanelAction =
  | {
      kind: "metric:set";
      target: MetricKey;
      label?: string;
      value?: number;
      flip?: boolean;
    }
  | {
      kind: "metric:updateByLabel";
      oldLabel: string;
      newLabel?: string;
      value?: number;
      flip?: boolean;
    }
  | { kind: "trend:set"; target: "sales"; to: "sales" | "people" }
  | { kind: "report:open"; month: string }
  | { kind: "report:compare"; months: [string, string] }
  | { kind: "report:close" };

const listeners = new Set<(a: PanelAction) => void>();
let lastAck: { ok: boolean; message?: string } | null = null;

export function onPanelAction(fn: (a: PanelAction) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function dispatchPanelAction(a: PanelAction): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(a);
    } catch {}
  }
}

export function clearPanelAck(): void {
  lastAck = null;
}
export function setPanelAck(ok: boolean, message?: string): void {
  lastAck = { ok, message };
}
export function getPanelAck(): { ok: boolean; message?: string } | null {
  return lastAck;
}

export function isPanelAction(x: unknown): x is PanelAction {
  if (typeof x !== "object" || x === null) return false;
  const obj: Record<string, unknown> = Object(x as unknown);
  const kind = obj.kind;
  if (kind === "metric:set") {
    const t = obj.target;
    const label = obj.label;
    const value = obj.value;
    const flip = obj.flip;
    return (
      (t === "revenue" ||
        t === "visitors" ||
        t === "conversion" ||
        t === "dwell" ||
        t === "energy" ||
        t === "wifi") &&
      (label === undefined || typeof label === "string") &&
      (value === undefined || typeof value === "number") &&
      (flip === undefined || typeof flip === "boolean")
    );
  }
  if (kind === "metric:updateByLabel") {
    const oldLabel = obj.oldLabel;
    const newLabel = obj.newLabel;
    const value = obj.value;
    const flip = obj.flip;
    return (
      typeof oldLabel === "string" &&
      (newLabel === undefined || typeof newLabel === "string") &&
      (value === undefined || typeof value === "number") &&
      (flip === undefined || typeof flip === "boolean")
    );
  }
  if (kind === "trend:set") {
    const target = obj.target;
    const to = obj.to;
    return target === "sales" && (to === "sales" || to === "people");
  }
  if (kind === "report:open") {
    const m = obj.month;
    return typeof m === "string" && /^(\d{4})-(0[1-9]|1[0-2])$/.test(m);
  }
  if (kind === "report:compare") {
    const ms = obj.months;
    if (!Array.isArray(ms) || ms.length !== 2) return false;
    const a = ms[0];
    const b = ms[1];
    return (
      typeof a === "string" &&
      typeof b === "string" &&
      /^(\d{4})-(0[1-9]|1[0-2])$/.test(a) &&
      /^(\d{4})-(0[1-9]|1[0-2])$/.test(b)
    );
  }
  if (kind === "report:close") {
    return true;
  }
  return false;
}

declare global {
  interface Window {
    panelDispatch?: (a: PanelAction) => void;
    panelGetAck?: () => { ok: boolean; message?: string } | null;
    panelSetAck?: (ok: boolean, message?: string) => void;
    panelClearAck?: () => void;
  }
}

if (typeof window !== "undefined") {
  window.panelDispatch = dispatchPanelAction;
  window.panelGetAck = getPanelAck;
  window.panelSetAck = setPanelAck;
  window.panelClearAck = clearPanelAck;
}

export function setMetricCard(params: {
  target: MetricKey;
  label?: string;
  value?: number;
  flip?: boolean;
}): void {
  const { target, label, value, flip } = params;
  dispatchPanelAction({ kind: "metric:set", target, label, value, flip });
}

export function setMetricByLabel(params: {
  oldLabel: string;
  newLabel?: string;
  value?: number;
  flip?: boolean;
}): void {
  const { oldLabel, newLabel, value, flip } = params;
  dispatchPanelAction({
    kind: "metric:updateByLabel",
    oldLabel,
    newLabel,
    value,
    flip,
  });
}

export function setTrend(to: "sales" | "people"): void {
  dispatchPanelAction({ kind: "trend:set", target: "sales", to });
}
