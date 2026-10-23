import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree, useFrame } from '@react-three/fiber'
import { deg2rad, focalToFov, sphericalPosition } from '../lib/camera'

// 把 scene/camera/gl 注册到外部 rig 对象（供导出函数与参数面板读取）
export function RigRegistrar({ rigRef }) {
  const { camera, gl, scene } = useThree()
  useEffect(() => {
    rigRef.current = { camera, gl, scene }
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
    if (camera.position.distanceTo(anim.current.pos) < 0.02) anim.current = null
  })

  // 供 OrbitControls onStart 调用：用户接管时停掉动画
  useEffect(() => {
    if (rigRef.current) rigRef.current.cancelAnim = () => (anim.current = null)
  }, [rigRef])
  return null
}

export { deg2rad }
