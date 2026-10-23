// 相机/焦段换算工具
//
// 等效焦段换算（全画幅基准）：
//   全画幅传感器高度 = 24mm，垂直视场角 fov = 2 * atan( 24 / (2 * focal) )
//     35mm -> 约 37.8°，50mm -> 约 27.0°，85mm -> 约 16.1°
//   反推：focal = 12 / tan(fov / 2)
// 切换焦段时按 focal 比例同步调整相机距离（dist *= newFocal / oldFocal），
// 使产品在画面中的占比大致不变（近似等效于真实摄影里换镜头后前后走位）。

export const SENSOR_HEIGHT_MM = 24

export function focalToFov(focalMm) {
  return (2 * Math.atan(SENSOR_HEIGHT_MM / (2 * focalMm)) * 180) / Math.PI
}

export function fovToFocal(fovDeg) {
  const half = (fovDeg * Math.PI) / 360
  return SENSOR_HEIGHT_MM / 2 / Math.tan(half)
}

export const deg2rad = (d) => (d * Math.PI) / 180
export const rad2deg = (r) => (r * 180) / Math.PI

// 机位预设：方位角 azimuth（0=正前方，绕 Y 轴，正值向右）、俯仰角 elevation（相对水平面）
export const CAMERA_PRESETS = {
  front: { label: '正视', azimuthDeg: 0, elevationDeg: 10, distance: 11.0 },
  three_quarter: { label: '3/4 侧视', azimuthDeg: 42, elevationDeg: 22, distance: 11.6 },
  top: { label: '俯视', azimuthDeg: 26, elevationDeg: 57, distance: 12.2 },
}

export const FOCALS = [35, 50, 85]

// 由方位/俯仰/距离计算相机位置（target 为注视点）
export function sphericalPosition(target, azimuthDeg, elevationDeg, distance) {
  const az = deg2rad(azimuthDeg)
  const el = deg2rad(elevationDeg)
  return [
    target[0] + distance * Math.cos(el) * Math.sin(az),
    target[1] + distance * Math.sin(el),
    target[2] + distance * Math.cos(el) * Math.cos(az),
  ]
}

// 从实际相机位置反推机位参数（导出 JSON 用，与真实画面口径一致）
// 字段约定（F 项补全）：
//   schema                 文件版本，导入时校验
//   fov_deg / fov_axis     fov 为「垂直」视场角（fov_axis: 'vertical'）
//   sensor_height_mm       全画幅等效垂直传感器高度 24mm（focal = 12 / tan(fov/2)）
//   azimuth_convention     方位角：0 = 相机在 +Z 轴正对 target，正值绕 +Y 转向 +X（画面右侧）
//   elevation_convention   俯仰角：相机高于 target 水平面的角度（度），俯视为正
//   units                  'scene'：场景单位；distance_to_target = 相机到注视点距离
//   camera_up / roll_deg   相机上方向与滚转（本工具始终 [0,1,0] / 0）
export function describeCamera(camera, targetVec) {
  const dx = camera.position.x - targetVec.x
  const dy = camera.position.y - targetVec.y
  const dz = camera.position.z - targetVec.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return {
    schema: 'studio3d/camera@1',
    azimuth_deg: +rad2deg(Math.atan2(dx, dz)).toFixed(2),
    elevation_deg: +rad2deg(Math.asin(dy / distance)).toFixed(2),
    distance: +distance.toFixed(3),
    distance_to_target: +distance.toFixed(3),
    fov_deg: +camera.fov.toFixed(2),
    fov_axis: 'vertical',
    focal_equiv_mm: +fovToFocal(camera.fov).toFixed(1),
    sensor_height_mm: SENSOR_HEIGHT_MM,
    near: +camera.near.toFixed(4),
    far: +camera.far.toFixed(4),
    camera_up: [0, 1, 0],
    roll_deg: 0,
    azimuth_convention:
      'deg; 0 = camera on +Z axis facing the target; positive = rotate toward +X (viewer right)',
    elevation_convention: 'deg above the horizontal plane through the target (looking down = positive)',
    units: 'scene',
    camera_position: [
      +camera.position.x.toFixed(3),
      +camera.position.y.toFixed(3),
      +camera.position.z.toFixed(3),
    ],
    target: [+targetVec.x.toFixed(3), +targetVec.y.toFixed(3), +targetVec.z.toFixed(3)],
  }
}
