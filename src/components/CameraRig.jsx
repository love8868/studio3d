import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { deg2rad, focalToFov, sphericalPosition } from '../lib/camera'

// 把 scene/camera/gl 注册到外部 rig 对象（供导出函数与参数面板读取）
// 用 Object.assign 就地更新，避免替换对象时丢掉 snap / cancelAnim 等注入方法
export function RigRegistrar({ rigRef }) {
  const { camera, gl, scene } = useThree()
  useEffect(() => {
    rigRef.current = Object.assign(rigRef.current || {}, { camera, gl, scene })
  }, [camera, gl, scene, rigRef])
  return null
}

// 相机动画：camCmd = { azimuthDeg, elevationDeg, distance, focalMm, seq }
// seq 每次 +1 触发一次平滑移动；用户手动拖 OrbitControls 时（onStart）取消动画
export function CameraRig({ camCmd, target, controlsRef, rigRef }) {
  const camera = useThree((s) => s.camera)
  const anim = useRef(null)

  useEffect(() => {
    if (!camCmd) return
    anim.current = {
      pos: new THREE.Vector3(
        ...sphericalPosition(target, camCmd.azimuthDeg, camCmd.elevationDeg, camCmd.distance),
      ),
      fov: focalToFov(camCmd.focalMm),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camCmd?.seq])

  useFrame((_, dt) => {
    if (rigRef.current) rigRef.current.target = target
    if (!anim.current) return
    const k = 1 - Math.exp(-dt * 4.5) // 指数平滑，约 0.7s 到位
    camera.position.lerp(anim.current.pos, k)
    camera.fov += (anim.current.fov - camera.fov) * k
    camera.updateProjectionMatrix()
    if (controlsRef.current) controlsRef.current.update()
    if (camera.position.distanceTo(anim.current.pos) < 0.02) {
      // 到位即「精确落位」：预设必须落在 42.00/22.00 而不是 41.6/56.4，
      // 否则导出 JSON 与画面口径有小数偏差
      camera.position.copy(anim.current.pos)
      camera.fov = anim.current.fov
      camera.updateProjectionMatrix()
      anim.current = null
      controlsRef.current?.update()
    }
  })

  // 供 OrbitControls onStart 调用：用户接管时停掉动画
  // snap：导出/导入前调用——把相机精确对齐到目标机位后停动画，避免导出抓到动画中途的一帧
  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    rig.cancelAnim = () => (anim.current = null)
    rig.snap = () => {
      if (anim.current) {
        camera.position.copy(anim.current.pos)
        camera.fov = anim.current.fov
        camera.updateProjectionMatrix()
        anim.current = null
      }
      controlsRef.current?.update()
    }
  }, [camera, controlsRef, rigRef])
  return null
}

export { deg2rad }
