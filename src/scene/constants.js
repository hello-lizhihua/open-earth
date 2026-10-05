// 场景常量：自 Godot 版 earth.gd 移植，尺寸按 globe.gl 球半径 100 等比放大（原单位球）。

export const GLOBE_RADIUS = 100;

// 高程位移：0.2 倍温和夸张，海洋齐平（0.000278 = 8849m / 6371km × 0.2，×100 球径）
export const TERRAIN_EXAGGERATION = 0.2;
export const TERRAIN_MAX_ELEV = 8849;
export const TERRAIN_MAX_DISPLACE = (TERRAIN_MAX_ELEV / 6371000) * TERRAIN_EXAGGERATION * GLOBE_RADIUS;

// 相机：注视点经纬度 + 距离；级 1 最远全球、级 10 最近贴地，线性等距
export const FOV_DEG = 50;
export const MAX_LAT = 88;
export const ZOOM_LEVELS = 10;
export const ZOOM_MIN_DISTANCE = 112;
export const ZOOM_MAX_DISTANCE = 500;
export const GLOBAL_LEVEL = 5;
export const START_LAT = 35;
export const START_LON = 105;
export const START_LEVEL = 8;
export const JUMP_DURATION = 600;

// 国界描边窄带（琥珀，与选中高亮同语言）/ 省界虚线（浅色，比国界细一档）/ 河流水线
// / 选中描边 / 高亮填充（尺寸按 100 倍球径换算）
export const BORDER_RADIUS = GLOBE_RADIUS * 1.002;
export const BORDER_WIDTH = 0.8;
export const BORDER_COLOR = 0xf2b93b;
export const BORDER_OPACITY = 0.9;
export const PROVINCE_RADIUS = GLOBE_RADIUS * 1.0012;
export const PROVINCE_WIDTH = 0.45;
export const PROVINCE_COLOR = 0xf7f3e8;
export const PROVINCE_OPACITY = 0.6;
export const PROVINCE_DASH = { on: 1.2, off: 0.8 };
export const RIVER_RADIUS = GLOBE_RADIUS * 1.0016;
export const RIVER_WIDTH = 0.35;
export const RIVER_COLOR = 0x3a6ea8;
export const RIVER_OPACITY = 0.65;
export const HIGHLIGHT_OVERLAY_RADIUS = GLOBE_RADIUS * 1.0008;
export const SELECT_FILL_COLOR = { r: 1.0, g: 0.8, b: 0.2, a: 0.5 };
export const SELECT_STROKE_RADIUS = GLOBE_RADIUS * 1.003;
export const SELECT_STROKE_WIDTH = 1.4;
// Shift 连续多选国家上限（遮罩填充逐国一球，防极端选择拖垮渲染）
export const MULTI_SELECT_LIMIT = 30;
export const SELECT_STROKE_COLOR = { r: 1.0, g: 0.843, b: 0.369, a: 0.95 };
export const RIBBON_STEP_RAD = 0.035;

// 多选编组按选中顺序取色（描边高饱和、填充同色低透明）
export const GROUP_COLORS = [
  { r: 1.0, g: 0.8, b: 0.2 },
  { r: 1.0, g: 0.4, b: 0.27 },
  { r: 0.27, g: 0.8, b: 0.53 },
  { r: 0.27, g: 0.53, b: 1.0 },
  { r: 0.8, g: 0.4, b: 1.0 },
  { r: 1.0, g: 0.53, b: 0.73 },
  { r: 0.53, g: 0.87, b: 1.0 },
  { r: 0.67, g: 0.87, b: 0.27 },
];

// 编组跨度阈值（弧度 ≈ 28.6°）：超过切全球机位距离
export const GROUP_GLOBAL_SPAN = 0.5;

// 点击 / 双击判定
export const TAP_MAX_MOVEMENT = 6;
export const TAP_MAX_MSEC = 500;
export const DOUBLE_TAP_MSEC = 350;
export const DOUBLE_TAP_MOVEMENT = 32;

// 国家名标签：白字暗描边，屏幕角半径不足隐藏，注视点边缘渐隐
export const LABEL_RADIUS = GLOBE_RADIUS * 1.012;
export const LABEL_MIN_PX = 26;

// 十段线（细带三角化填充，中国标准地图要素）
export const CHINA_ISO = "CN";

export const PRESENTATION_OPTIONS = [
  { label: "模拟地图", value: "stylized" },
  { label: "卫星影像", value: "satellite" },
  { label: "政治区划", value: "political" },
  { label: "人口着色", value: "population" },
  { label: "经济着色", value: "gdp" },
];
