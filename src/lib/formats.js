// 导出画幅表：8 个常用电商/社媒规格。默认 4:3 = 历史口径（1400×1050），保持现状。
// 预览画幅与导出画幅必须一致（同一 aspect 用于 4:3 取景框与 fit-to-object）。
export const FORMATS = [
  { key: '4x3', label: '4:3', w: 1400, h: 1050 },
  { key: '1x1', label: '1:1', w: 2000, h: 2000 },
  { key: '4x5', label: '4:5', w: 1600, h: 2000 },
  { key: '3x4', label: '3:4', w: 1500, h: 2000 },
  { key: '2x3', label: '2:3', w: 1600, h: 2400 },
  { key: '3x2', label: '3:2', w: 1800, h: 1200 },
  { key: '16x9', label: '16:9', w: 1920, h: 1080 },
  { key: '9x16', label: '9:16', w: 1080, h: 1920 },
]

export const DEFAULT_FORMAT_KEY = '4x3'
export const DEFAULT_FORMAT = FORMATS[0]

// 按 key 取画幅，未知 key 回退默认 4:3
export function getFormat(key) {
  return FORMATS.find((f) => f.key === key) || DEFAULT_FORMAT
}

export function aspectOf(key) {
  const f = getFormat(key)
  return f.w / f.h
}

// 校验导出尺寸（整数、>=64、<=4096），非法回退默认。供 exporter 统一入口使用。
export function resolveSize(size) {
  const w = Math.round(Number(size?.w))
  const h = Math.round(Number(size?.h))
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 64 && w <= 4096 && h >= 64 && h <= 4096) {
    return { w, h }
  }
  return { w: DEFAULT_FORMAT.w, h: DEFAULT_FORMAT.h }
}
