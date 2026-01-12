export const mockHotspots = [
  { id: "h1", floor: 1, x: 18, y: 30, intensity: 0.35, label: "入口左侧" },
  { id: "h2", floor: 1, x: 46, y: 56, intensity: 0.72, label: "A区中部" },
  { id: "h3", floor: 1, x: 72, y: 40, intensity: 0.85, label: "A区靠里" },
  { id: "h4", floor: 2, x: 28, y: 38, intensity: 0.42, label: "B区走廊" },
  { id: "h5", floor: 2, x: 60, y: 58, intensity: 0.63, label: "二层电梯口" },
  { id: "h6", floor: 3, x: 32, y: 32, intensity: 0.25, label: "展览区外围" },
  { id: "h7", floor: 3, x: 68, y: 50, intensity: 0.78, label: "展览区主舞台" },
];

export type Decision = {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
};

export const mockDecisions: Decision[] = [
  {
    id: "d1",
    title: "A区用户较少，建议下发半价优惠券",
    description: "预计转化提升 18%–26%，覆盖 A 区与入口附近人群。",
    priority: "high",
  },
  {
    id: "d2",
    title: "二层电梯口投放导流标识",
    description: "提升 2F 向 A 区人流引导效率，预计 +9%。",
    priority: "medium",
  },
  {
    id: "d3",
    title: "展览区主舞台追加签到抽奖",
    description: "提高停留时长与互动率，预计 +12%。",
    priority: "low",
  },
];

export type Stat = {
  revenue: number;
  visitors: number;
  hotZones: { name: string; value: number }[];
  hotEvents: { name: string; value: number }[];
  conversionRate: number;
  dwellTimeAvgMin: number;
  couponRedemptionRate: number;
  occupancyRate: number;
  deviceOnlineRate: number;
  energyKwh: number;
  wifiConnections: number;
  arEngagementRate: number;
  salesPerMinute: number[];
};

export const mockStats: Stat = {
  revenue: 1289432,
  visitors: 3921,
  hotZones: [
    { name: "展览区主舞台", value: 92 },
    { name: "A区中部", value: 74 },
    { name: "二层电梯口", value: 61 },
  ],
  hotEvents: [
    { name: "签到抽奖", value: 88 },
    { name: "半价券发放", value: 69 },
    { name: "导流标识", value: 52 },
  ],
  conversionRate: 37,
  dwellTimeAvgMin: 28,
  couponRedemptionRate: 42,
  occupancyRate: 63,
  deviceOnlineRate: 96,
  energyKwh: 418,
  wifiConnections: 1267,
  arEngagementRate: 18,
  salesPerMinute: Array.from({ length: 60 }).map((_, i) => {
    const base =
      12 + Math.round(10 * Math.sin(i * 0.28) + 6 * Math.sin(i * 0.07 + 1.2));
    return Math.max(6, base);
  }),
};

export type MonthlyReport = {
  monthKey: string;
  revenueTotal: number;
  visitorsTotal: number;
  ordersTotal: number;
  conversionRate: number;
  avgOrderValue: number;
  weeklyRevenue: number[];
  weeklyVisitors: number[];
  channels: { pos: number; miniapp: number };
  segments: {
    newCustomerRate: number;
    repeatRate: number;
    maleRate: number;
    femaleRate: number;
    ageGroups: { label: string; rate: number }[];
  };
  advices: string[];
};

export const mockMonthlyReports: Record<string, MonthlyReport> = {
  "2025-08": {
    monthKey: "2025-08",
    revenueTotal: 12198340,
    visitorsTotal: 89260,
    ordersTotal: 38642,
    conversionRate: 43,
    avgOrderValue: Math.round(12198340 / 38642),
    weeklyRevenue: [2718400, 2983200, 3185100, 3311400],
    weeklyVisitors: [20810, 22340, 23100, 23010],
    channels: { pos: 66, miniapp: 34 },
    segments: {
      newCustomerRate: 41,
      repeatRate: 59,
      maleRate: 49,
      femaleRate: 51,
      ageGroups: [
        { label: "18–24", rate: 20 },
        { label: "25–34", rate: 34 },
        { label: "35–44", rate: 27 },
        { label: "45+", rate: 19 },
      ],
    },
    advices: [
      "工作日午后人流回落，建议14:30发放限时券",
      "入口导流标识优化，提升一层向A区转化率",
      "签到抽奖提升留存，可与专题活动联动",
    ],
  },
  "2025-09": {
    monthKey: "2025-09",
    revenueTotal: 14475120,
    visitorsTotal: 101430,
    ordersTotal: 48221,
    conversionRate: 48,
    avgOrderValue: Math.round(14475120 / 48221),
    weeklyRevenue: [3219400, 3568100, 3712200, 3965410],
    weeklyVisitors: [23410, 25480, 26210, 26320],
    channels: { pos: 54, miniapp: 46 },
    segments: {
      newCustomerRate: 33,
      repeatRate: 67,
      maleRate: 46,
      femaleRate: 54,
      ageGroups: [
        { label: "18–24", rate: 16 },
        { label: "25–34", rate: 37 },
        { label: "35–44", rate: 31 },
        { label: "45+", rate: 16 },
      ],
    },
    advices: [
      "周末峰值明显，建议加码AR互动与抽奖",
      "线上占比提升，建议优化小程序转化漏斗",
      "主舞台热度高，增加分时段互动提升停留",
    ],
  },
};
