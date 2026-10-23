import * as THREE from 'three'
import { describeCamera } from './camera'

function download(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

const EXPORT_W = 1400
const EXPORT_H = 1050

// 导出专用白色背景（视口是深色影棚，导出渲染图口径仍是白底，渲染这一帧时强制换白、渲完还原）
const EXPORT_BG = new THREE.Color('#ffffff')

// 临时把渲染器切到导出分辨率渲染一帧，返回 dataURL，然后恢复原尺寸
function renderAtExportSize(rig, prepare) {
  const { gl, scene, camera } = rig
  const size = new THREE.Vector2()
  gl.getSize(size)
  const pixelRatio = gl.getPixelRatio()
  const oldAspect = camera.aspect
  const oldBackground = scene.background
  if (prepare) prepare()
  scene.background = EXPORT_BG
  gl.setPixelRatio(1)
  gl.setSize(EXPORT_W, EXPORT_H, false)
  camera.aspect = EXPORT_W / EXPORT_H
  camera.updateProjectionMatrix()
  gl.render(scene, camera)
  const url = gl.domElement.toDataURL('image/png')
  scene.background = oldBackground
  gl.setPixelRatio(pixelRatio)
  gl.setSize(size.x, size.y, false)
  camera.aspect = oldAspect
  camera.updateProjectionMatrix()
  gl.render(scene, camera)
  return url
}

// ① 渲染图 PNG：白底（已选定白底，与电商主图口径一致），1400x1050（宽 >=1024）
export function exportRenderPNG(rig) {
  if (!rig?.gl) return
  const url = renderAtExportSize(rig)
  download(url, 'studio-render.png')
}

// ①′ 干净渲染图 PNG（AI 交接版）：隐藏影棚地面（光池圆盘 + 只接阴影的透明面）后渲染，
// 白底、只有产品，不带地面与接触阴影——阴影留给生图 AI 在最终场景里按场景光现画。
// 恢复时机说明：renderAtExportSize 结尾会用当前场景重绘一帧视口，那一帧仍是无地面状态；
// 本函数返回后立即恢复 visible，R3F 连续渲染会在下一帧把地面画回来，视口最多差一帧（同步执行，肉眼基本不可见）。
export function exportCleanRenderPNG(rig, groundObj) {
  if (!rig?.gl) return
  const oldVisible = groundObj ? groundObj.visible : undefined
  if (groundObj) groundObj.visible = false
  const url = renderAtExportSize(rig)
  if (groundObj) groundObj.visible = oldVisible
  download(url, 'studio-clean.png')
}

// three.js RGBADepthPacking 的 JS 解包（与官方 shader chunk unpackRGBAToDepth 等价）：
//   depth = dot(rgba01, (1, 1/255, 1/65536, 1/16777216))
function unpackRGBAToDepth(r, g, b, a) {
  return r / 255 + g / 255 / 255 + b / 255 / 65536 + a / 255 / 16777216
}

// ② 深度图 PNG：真正的深度渲染，不是普通截图
//   - scene.overrideMaterial = MeshDepthMaterial(RGBADepthPacking) 单独渲染到 RenderTarget
//   - 渲染前把相机 near/far 临时收紧到产品前后（深度对比更明显）
//   - 清屏色设为白色：解包后 depth=1 -> 反相灰度=0（黑=最远），背景自然为黑
//   - readRenderTargetPixels 读回 packed RGBA，JS 解包 -> 反相灰度（近白远黑）-> 2D canvas 出图
// groundObj 可选：传入时在深度渲染期间隐藏影棚地面（只留产品几何），渲完恢复；不传则行为与原来完全一致
export function exportDepthPNG(rig, targetVec, groundObj) {
  if (!rig?.gl) return
  const { gl, scene, camera } = rig
  const rt = new THREE.WebGLRenderTarget(EXPORT_W, EXPORT_H)
  const pixels = new Uint8Array(EXPORT_W * EXPORT_H * 4)
  const oldGroundVisible = groundObj ? groundObj.visible : undefined
  if (groundObj) groundObj.visible = false

  const oldOverride = scene.overrideMaterial
  const oldBackground = scene.background
  const oldNear = camera.near
  const oldFar = camera.far
  const oldClearColor = new THREE.Color()
  gl.getClearColor(oldClearColor)
  const oldClearAlpha = gl.getClearAlpha()

  const dist = camera.position.distanceTo(targetVec)
  camera.near = Math.max(0.1, dist - 4)
  camera.far = dist + 6
  camera.updateProjectionMatrix()

  scene.overrideMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  })
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
  camera.updateProjectionMatrix()
  gl.setClearColor(oldClearColor, oldClearAlpha)
  // 地面在视口恢复渲染之前恢复可见，保证视口那一帧就是正常影棚画面
  if (groundObj) groundObj.visible = oldGroundVisible
  gl.render(scene, camera)
  rt.dispose()

  // readRenderTargetPixels 是自下而上（OpenGL 原点在左下），写 2D canvas 时翻转 Y
  const canvas = document.createElement('canvas')
  canvas.width = EXPORT_W
  canvas.height = EXPORT_H
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(EXPORT_W, EXPORT_H)
  for (let y = 0; y < EXPORT_H; y++) {
    const srcRow = EXPORT_H - 1 - y
    for (let x = 0; x < EXPORT_W; x++) {
      const si = (srcRow * EXPORT_W + x) * 4
      const di = (y * EXPORT_W + x) * 4
      const depth = unpackRGBAToDepth(pixels[si], pixels[si + 1], pixels[si + 2], pixels[si + 3])
      const gray = Math.round(255 * THREE.MathUtils.clamp(1 - depth, 0, 1))
      img.data[di] = gray
      img.data[di + 1] = gray
      img.data[di + 2] = gray
      img.data[di + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  // 自检统计（供无头验收读回核对：真实深度图应有大范围灰度分布，背景纯黑）
  let mn = 255, mx = 0, sum = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const g = img.data[i]
    if (g < mn) mn = g
    if (g > mx) mx = g
    sum += g
  }
  window.__lastDepthStats = {
    width: EXPORT_W, height: EXPORT_H,
    grayMin: mn, grayMax: mx,
    grayMean: +(sum / (EXPORT_W * EXPORT_H)).toFixed(2),
  }
  download(canvas.toDataURL('image/png'), 'studio-depth.png')
}

// ③ 机位参数 JSON：从真实相机位置反推，保证与画面一致
export function buildCameraParams(rig, targetVec, extra) {
  if (!rig?.camera) return null
  return {
    ...describeCamera(rig.camera, targetVec),
    ...extra,
    exported_at: new Date().toISOString(),
  }
}

export function exportCameraJSON(rig, targetVec, extra) {
  const params = buildCameraParams(rig, targetVec, extra)
  if (!params) return
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  download(url, 'camera-params.json')
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// AI 交接包（干净版）：干净渲染图 + 干净深度图 + 机位参数，三件都不带影棚地面与接触阴影。
// 三个下载连发，部分浏览器会拦截多文件下载，按钮小字已提示用户放行。
export function exportAIBundle(rig, groundObj, targetVec, extra) {
  exportCleanRenderPNG(rig, groundObj)
  exportDepthPNG(rig, targetVec, groundObj)
  exportCameraJSON(rig, targetVec, extra)
}
