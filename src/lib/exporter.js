import * as THREE from 'three'
import { zipSync, strToU8 } from 'fflate'
import { describeCamera } from './camera'

function download(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

const EXPORT_W = 1400
const EXPORT_H = 1050

// 导出专用白色背景（视口是深色影棚；白底渲染图这一帧强制换白、渲完还原）
const EXPORT_BG = new THREE.Color('#ffffff')

// ---------- 文件名（G 项）：同一批次共用同一主名 stem ----------
const pad2 = (n) => String(n).padStart(2, '0')
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`
}
const slug = (s) => String(s ?? '').replace(/[^A-Za-z0-9]+/g, '')

// studio3d_<mode>_<preset>_az<az>_el<el>_<focal>mm_<yyyymmdd-hhmm>
export function buildFileStem(rig, targetVec, extra) {
  const cam = rig?.camera
  if (!cam || !targetVec) return `studio3d_scene_${stamp()}`
  const p = describeCamera(cam, targetVec)
  const mode = slug(extra?.object_mode) || 'scene'
  const preset = slug(extra?.camera_preset) || 'cam'
  return `studio3d_${mode}_${preset}_az${Math.round(p.azimuth_deg)}_el${Math.round(p.elevation_deg)}_${Math.round(
    p.focal_equiv_mm,
  )}mm_${stamp()}`
}

// dataURL(png) -> Uint8Array（zip 用）
function dataURLToBytes(url) {
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// 临时把渲染器切到导出分辨率（1400×1050，4:3）渲染一帧，返回 dataURL，然后恢复原尺寸/背景/隐藏态。
// opts:
//   hide: Object3D[]        渲染这一帧时隐藏（渲完先还原再重绘视口，屏幕不留导出态）
//   transparent: boolean    true → scene.background=null + clearAlpha=0（干净版透明底）
//   aspect 固定为 1400/1050：预览/渲染/深度统一 4:3 口径
function renderAtExportSize(rig, opts = {}) {
  const { gl, scene, camera } = rig
  if (!gl) return null
  const { hide = [], transparent = false } = opts
  const size = new THREE.Vector2()
  gl.getSize(size)
  const pixelRatio = gl.getPixelRatio()
  const oldAspect = camera.aspect
  const oldBackground = scene.background
  const oldClearAlpha = gl.getClearAlpha()
  const prevVisible = hide.map((o) => (o ? o.visible : undefined))
  hide.forEach((o) => {
    if (o) o.visible = false
  })

  scene.background = transparent ? null : EXPORT_BG
  gl.setClearAlpha(transparent ? 0 : 1)
  gl.setPixelRatio(1)
  gl.setSize(EXPORT_W, EXPORT_H, false)
  camera.aspect = EXPORT_W / EXPORT_H
  camera.updateProjectionMatrix()
  gl.render(scene, camera)
  const url = gl.domElement.toDataURL('image/png')

  hide.forEach((o, i) => {
    if (o) o.visible = prevVisible[i]
  })
  scene.background = oldBackground
  gl.setClearAlpha(oldClearAlpha)
  gl.setPixelRatio(pixelRatio)
  gl.setSize(size.x, size.y, false)
  camera.aspect = oldAspect
  camera.updateProjectionMatrix()
  gl.render(scene, camera)
  return url
}

// ① 渲染图 PNG：白底 1400×1050。opts.disc：隐藏深色光池圆盘（保留 ShadowMaterial 接地阴影面）。
export function exportRenderPNG(rig, opts = {}) {
  if (!rig?.gl) return null
  rig.snap?.()
  const { disc, target, targetVec, extra } = opts
  const aim = target ?? targetVec
  const url = renderAtExportSize(rig, { hide: disc ? [disc] : [] })
  download(url, `${buildFileStem(rig, aim, extra)}.png`)
  return url
}

// 收集标了 userData.noExport 的「根」对象（找到即整棵子树跳过导出，避免重复收集子节点）。
// 目前用于 mount 模式的 ghost 墙 / ghost 显示屏：它们只作取景参考，不进干净图与深度图。
function collectNoExport(scene) {
  const list = []
  const visit = (o) => {
    if (o.userData && o.userData.noExport) {
      list.push(o)
      return
    }
    const children = o.children || []
    for (let i = 0; i < children.length; i++) visit(children[i])
  }
  if (scene) visit(scene)
  return list
}

// ①′ 干净渲染图（AI 交接版）：隐藏整个影棚地面组（光池圆盘 + 阴影面）+ 所有 noExport 辅助对象（ghost），
// transparent=true 时透明底（alpha=0）。返回 dataURL，不自动下载（供 bundle 复用）。
export function renderCleanPNG(rig, opts = {}) {
  if (!rig?.gl) return null
  rig.snap?.()
  const { ground, transparent = false } = opts
  const hide = collectNoExport(rig.scene)
  if (ground) hide.push(ground)
  return renderAtExportSize(rig, { hide, transparent })
}

// three.js RGBADepthPacking 的 JS 解包（与官方 shader chunk unpackRGBAToDepth 等价）：
//   depth(0..1) = dot(rgba01, UnpackFactors4)，UnpackFactors4 = (255/256, 255/256/256, 255/256/65536, 1/16777216)
//   换算到 0..255 通道：r/255 + g/255/255 + b/255/65536 + a/255/16777216
function unpackRGBAToDepth(r, g, b, a) {
  return r / 255 + g / 255 / 255 + b / 255 / 65536 + a / 255 / 16777216
}

// ② 深度图 PNG：单一代码路径（独立按钮与 AI bundle 都调用本函数，参数完全一致）。
//   - 临时收紧 camera.near/far 到产品前后 → 深度对比更强
//   - 强制 camera.aspect = 1400/1050 → 与干净图同口径，消除横向拉伸
//   - 始终隐藏影棚地面组（ground）与 noExport 辅助对象（ghost 墙/屏），只留产品几何
//   - MeshDepthMaterial(RGBADepthPacking) 渲到 RT，读回 packed RGBA
//   - 解包得到 gl_FragCoord.z(0..1) → 线性视深 viewZ → 归一化逆深度（近白远黑）
//   opts: { target, ground, extra, stem, download=true }
//   返回 { url, near, far }（download=false 时供 bundle 组装 JSON）
export function exportDepthPNG(rig, opts = {}) {
  if (!rig?.gl) return null
  const { target, ground, extra, stem: stemIn, download: doDownload = true } = opts
  rig.snap?.()
  const { gl, scene, camera } = rig
  const rt = new THREE.WebGLRenderTarget(EXPORT_W, EXPORT_H)
  const pixels = new Uint8Array(EXPORT_W * EXPORT_H * 4)

  // 隐藏影棚地面组 + 所有 noExport 辅助对象（ghost 墙/屏），只留产品几何
  const hideList = collectNoExport(scene)
  if (ground) hideList.push(ground)
  const prevHidden = hideList.map((o) => o.visible)
  hideList.forEach((o) => {
    o.visible = false
  })

  const oldOverride = scene.overrideMaterial
  const oldBackground = scene.background
  const oldNear = camera.near
  const oldFar = camera.far
  const oldAspect = camera.aspect
  const oldClearColor = new THREE.Color()
  gl.getClearColor(oldClearColor)
  const oldClearAlpha = gl.getClearAlpha()

  const dist = target ? camera.position.distanceTo(target) : Math.max(1, oldFar - 1)
  const near = Math.max(0.1, dist - 4)
  const far = dist + 6
  camera.near = near
  camera.far = far
  camera.aspect = EXPORT_W / EXPORT_H
  camera.updateProjectionMatrix()

  scene.overrideMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  scene.background = null
  gl.setClearColor(0xffffff, 1)
  gl.setRenderTarget(rt)
  gl.render(scene, camera)
  gl.readRenderTargetPixels(rt, 0, 0, EXPORT_W, EXPORT_H, pixels)
  gl.setRenderTarget(null)

  scene.overrideMaterial.dispose()
  scene.overrideMaterial = oldOverride
  scene.background = oldBackground
  camera.near = oldNear
  camera.far = oldFar
  camera.aspect = oldAspect
  camera.updateProjectionMatrix()
  gl.setClearColor(oldClearColor, oldClearAlpha)
  hideList.forEach((o, i) => {
    o.visible = prevHidden[i]
  })
  gl.render(scene, camera)
  rt.dispose()

  // gl_FragCoord.z(0..1) → NDC → 线性视深 → 归一化视差 (1/z - 1/far)/(1/near - 1/far)
  // 近处 → 1（白），远处 → 0（黑）；背景清屏为远平面 → 黑。
  const invNear = 1 / near
  const invFar = 1 / far
  const invRange = invNear - invFar
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(EXPORT_W, EXPORT_H)
  let mn = 255
  let mx = 0
  let sum = 0
  for (let y = 0; y < EXPORT_H; y++) {
    const srcRow = EXPORT_H - 1 - y // readRenderTargetPixels 自下而上，写 2D canvas 时翻转 Y
    for (let x = 0; x < EXPORT_W; x++) {
      const si = (srcRow * EXPORT_W + x) * 4
      const di = (y * EXPORT_W + x) * 4
      const fragZ = Math.min(1, Math.max(0, unpackRGBAToDepth(pixels[si], pixels[si + 1], pixels[si + 2], pixels[si + 3])))
      const ndc = fragZ * 2 - 1
      const viewZ = (2 * near * far) / (far + near - ndc * (far - near))
      const disparity = (1 / viewZ - invFar) / invRange
      const gray = Math.round(255 * Math.min(1, Math.max(0, disparity)))
      img.data[di] = gray
      img.data[di + 1] = gray
      img.data[di + 2] = gray
      img.data[di + 3] = 255
      if (gray < mn) mn = gray
      if (gray > mx) mx = gray
      sum += gray
    }
  }
  ctx.putImageData(img, 0, 0)
  // 自检统计（供无头验收读回核对：背景纯黑、无地面、灰度有分布）
  window.__lastDepthStats = {
    width: EXPORT_W,
    height: EXPORT_H,
    near: +near.toFixed(3),
    far: +far.toFixed(3),
    grayMin: mn,
    grayMax: mx,
    grayMean: +(sum / (EXPORT_W * EXPORT_H)).toFixed(2),
  }
  const url = canvas.toDataURL('image/png')
  if (doDownload) {
    const stem = stemIn || buildFileStem(rig, target, extra)
    download(url, `${stem}-depth.png`)
  }
  return { url, near, far }
}

// ③ 机位参数 JSON：从真实相机位置反推，保证与画面一致 + F 项补全字段
export function buildCameraParams(rig, targetVec, extra = {}, opts = {}) {
  if (!rig?.camera) return null
  const params = {
    ...describeCamera(rig.camera, targetVec),
    image_width: EXPORT_W,
    image_height: EXPORT_H,
    aspect_ratio: +(EXPORT_W / EXPORT_H).toFixed(4),
    ground_included: false,
    export: {
      mode: extra.object_mode ?? null,
      preset: extra.camera_preset ?? null,
      transparent: !!opts.transparent,
    },
    ...extra,
    exported_at: new Date().toISOString(),
  }
  if (opts.depth) params.depth = opts.depth
  return params
}

// ③′ 机位参数 JSON 下载。opts: { target, extra, transparent, depth, stem }
export function exportCameraJSON(rig, opts = {}) {
  if (!rig?.camera) return null
  rig.snap?.()
  const { target, extra = {}, transparent = false, depth, stem: stemIn } = opts
  const params = buildCameraParams(rig, target, extra, { transparent, depth })
  if (!params) return null
  const stem = stemIn || buildFileStem(rig, target, extra)
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  download(url, `${stem}.json`)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { params, stem }
}

// KEEP/CHANGE 提示词模板（README 用）
const KEEP_CHANGE_PROMPT =
  'KEEP EXACTLY: camera angle, framing, subject position/scale/proportions, exact silhouette. CHANGE ONLY: materials, lighting, background. No rider, no text, no extra props, no clay/CGI look.'

function buildReadme({ stem, transparent }) {
  return `studio3d AI 交接包 / AI handoff bundle
generated: ${new Date().toISOString()}
stem: ${stem}

== 包含文件 / files ==
- ${stem}-clean.png   干净渲染图：只有产品，无地面、无阴影${
    transparent ? '，透明底（产品外 alpha=0）' : '，白底'
  }
    Clean render: product only, no ground, no shadow${
      transparent ? ', transparent background (alpha 0 outside the product)' : ', opaque white background'
    }.
- ${stem}-depth.png   深度图：8-bit 逆线性视差（inverse linear disparity），近=白、远=黑，背景纯黑
    Depth map: 8-bit inverse linear disparity, near = white, far = black, background black.
- ${stem}.json         机位参数 / camera parameters（可导入本工具复现机位）
- README.txt

== 机位 JSON 字段说明 / camera JSON field meanings ==
- schema: "studio3d/camera@1"（导入校验用 / version tag for import）
- fov_deg + fov_axis: "vertical" —— 这是「垂直」视场角，不是水平 HFOV。
- sensor_height_mm: 24 —— 全画幅等效垂直传感器高度；focal_equiv_mm = 12 / tan(fov/2)。
- azimuth_deg: 方位角。0 = 相机在 +Z 轴正对 target，正值绕 +Y 朝向 +X（画面右侧）。
- elevation_deg: 俯仰角。相机高于 target 水平面的角度（度），俯视为正。
- camera_up: [0,1,0]；roll_deg: 0（无滚转）。
- units: "scene"（场景单位）；distance_to_target = 相机到注视点距离。
- target / camera_position: 场景坐标系下的点，可用于复现相机摆放。
- export.transparent: 干净图是否为透明底。
- depth.near / depth.far: 生成深度图时使用的临时相机近/远平面（归一化用）。

== 深度图用途与限制 / depth caveat ==
主流生图 API 不接受 depth / pose 通道：Gemini 与 OpenAI 的图像接口都不支持深度或姿态输入。
本深度图仅适用于支持 depth 条件的模型/平台，例如：
- Qwen-Image-Edit + ControlNet Union
- fal.ai 的 flux-general（depth/control 条件）
- Runware 等支持 depth 条件的服务
其它文生图 / 图生图模型请只使用 clean 渲染图 + 文字提示词，不要上传深度图。

== 推荐提示词模板 / recommended prompt template ==
${KEEP_CHANGE_PROMPT}

说明：只保留机位/构图/主体，只改材质、灯光与背景；不要骑手、不要文字、不要额外道具、不要黏土/CGI 感。
`
}

// ④ AI 交接包：干净渲染图 + 深度图 + 机位 JSON + README，打包成「一个」ZIP（浏览器拦截多文件下载）。
// opts: { ground, target, extra, transparent }
export function exportAIBundle(rig, opts = {}) {
  if (!rig?.gl || !rig?.camera) return null
  const { ground, target, extra = {}, transparent = false } = opts
  rig.snap?.()
  const stem = buildFileStem(rig, target, extra)
  const cleanUrl = renderCleanPNG(rig, { ground, transparent })
  const depth = exportDepthPNG(rig, { target, ground, extra, stem, download: false })
  const params = buildCameraParams(rig, target, extra, {
    transparent,
    depth: {
      encoding: 'inverse-linear-disparity',
      bits: 8,
      near: depth?.near ?? null,
      far: depth?.far ?? null,
      near_is: 'white',
    },
  })
  const files = {
    [`${stem}-clean.png`]: dataURLToBytes(cleanUrl),
    [`${stem}-depth.png`]: dataURLToBytes(depth.url),
    [`${stem}.json`]: strToU8(JSON.stringify(params, null, 2)),
    'README.txt': strToU8(buildReadme({ stem, transparent })),
  }
  const zip = zipSync(files, { level: 6 })
  const blob = new Blob([zip], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  download(url, `${stem}.zip`)
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  window.__lastBundle = { stem, files: Object.keys(files) } // 无头验收探针
  return { stem, files: Object.keys(files) }
}
