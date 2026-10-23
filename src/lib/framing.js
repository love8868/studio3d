import * as THREE from 'three'
import { deg2rad } from './camera.js'

// ---------- fit-to-object 自动取景 ----------
// 取代写死的 FRAMING / MOUNT_FRAMING / CABLE_FRAMING 距离倍率：
// 用主体包围盒 + 当前 aspect/focal 的垂直-水平 FOV，反解「刚好装下包围盒」的相机距离。
//
// 推导：相机位于 center + distance·dir（dir 为 target→camera 单位向量）。
// 对包围盒 8 个角点 c，设 w = c - center，则相机空间中
//   纵深   depth = dot(w, forward) + distance        （forward = -dir）
//   水平/垂直偏移 x = dot(w, right)、y = dot(w, camUp)
// 约束 |x| ≤ tanH·depth、|y| ≤ tanV·depth 反解得
//   distance ≥ |x|/tanH - dot(w, forward)（垂直同理），对所有角点取最大。
// margin 通过收窄有效 tan 实现（留边距，越小越紧）。
export function fitDistance({ aspect, fovDeg, azimuthDeg, elevationDeg, box, center, margin = 0.1 }) {
  const tanV = Math.tan(deg2rad(fovDeg) / 2) * (1 - margin)
  const tanH = tanV * aspect
  const dir = new THREE.Vector3(
    Math.cos(deg2rad(elevationDeg)) * Math.sin(deg2rad(azimuthDeg)),
    Math.sin(deg2rad(elevationDeg)),
    Math.cos(deg2rad(elevationDeg)) * Math.cos(deg2rad(azimuthDeg)),
  )
  const forward = dir.clone().negate()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const camUp = new THREE.Vector3().crossVectors(right, forward).normalize()

  let d = 0
  const w = new THREE.Vector3()
  for (let i = 0; i < 8; i++) {
    w.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    ).sub(center)
    const fwd = w.dot(forward)
    d = Math.max(d, Math.abs(w.dot(right)) / tanH - fwd, Math.abs(w.dot(camUp)) / tanV - fwd)
  }
  return Math.max(d, 0.5)
}

// 量主体（当前对象组）的世界包围盒：逐个 mesh 取几何包围盒再变换到世界空间。
// 跳过带 userData.noFit 的对象及其子树（ghost 屏 / ghost 墙 / 辅助面），只量产品本体。
export function measureSubject(root) {
  const box = new THREE.Box3()
  if (!root) return box
  const tmp = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    for (let n = o; n; n = n.parent) {
      if (n.userData && n.userData.noFit) return
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
    if (!o.geometry.boundingBox) return
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
    box.union(tmp)
  })
  return box
}
