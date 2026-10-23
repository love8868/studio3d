import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useTexture, RoundedBox } from '@react-three/drei'

// 充电柜 181488 盒体比例（估算，见 README）：
//   正面图裁切宽高比 W/H≈1.289、侧面图 D/H≈1.209，取 H=3.0 则 W=3.86、D=3.63（单位为场景单位，非实物 mm）
export const CABINET_SIZE = { w: 3.86, h: 3.0, d: 3.63 }
const BODY_COLOR = '#43484f' // 深灰，近似机身色（无贴图面用；略提亮避免无环境贴图时标准材质发黑）

// 贴图路径必须带 BASE_URL：部署在子路径（如 GitHub Pages 的 /studio3d-prototype/）时
// 写死 '/textures/...' 会指到域名根目录 404，Suspense 抛错且无边界时会整页白屏（v0.1 实测教训）
const TEX = (name) => `${import.meta.env.BASE_URL}textures/cabinet/${name}`

export function CabinetBox() {
  const [front, side, back] = useTexture([TEX('front.jpg'), TEX('side.jpg'), TEX('back.jpg')])
  useMemo(() => {
    for (const t of [front, side, back]) {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
    }
  }, [front, side, back])
  // 左侧面用侧面图镜像，避免拉伸出另一张不同的脸
  const sideMirror = useMemo(() => {
    const t = side.clone()
    t.wrapS = THREE.RepeatWrapping
    t.repeat.x = -1
    t.needsUpdate = true
    return t
  }, [side])

  const { w, h, d } = CABINET_SIZE
  // BoxGeometry 材质顺序: [+x 右, -x 左, +y 顶, -y 底, +z 前, -z 后]
  // 贴图面用 meshBasicMaterial（不吃光）：官网贴图自带光影，再打光会双重光影（蓝图既定做法）
  return (
    <mesh position={[0, h / 2, 0]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshBasicMaterial attach="material-0" map={side} />
      <meshBasicMaterial attach="material-1" map={sideMirror} />
      <meshStandardMaterial attach="material-2" color={BODY_COLOR} roughness={0.7} metalness={0.1} />
      <meshStandardMaterial attach="material-3" color={BODY_COLOR} roughness={0.7} metalness={0.1} />
      <meshBasicMaterial attach="material-4" map={front} />
      <meshBasicMaterial attach="material-5" map={back} />
    </mesh>
  )
}

// ---------- 线型档案（v0.4）：{线径倍率, 接头模型, 线身颜色, 硬度→垂坠系数} ----------
// sagFactor：垂坠深度系数，软线（USB-C）垂得多、硬线（电源线）垂得少；
// 只放大/缩小「偏离默认」的垂坠量，默认值下各预设与 v0.3 构图严格一致
export const CABLE_BASE_RADIUS = 0.055
export const CABLE_TYPES = {
  usbc: { label: 'USB-C', radiusMul: 0.7, color: '#59616c', sagFactor: 1.15, plug: 'usbc' },
  lan: { label: '网线', radiusMul: 1.05, color: '#2a6fd6', sagFactor: 1.0, plug: 'rj45' },
  hdmi: { label: 'HDMI', radiusMul: 1.3, color: '#3a3f45', sagFactor: 0.9, plug: 'hdmi' },
  power: { label: '电源线', radiusMul: 1.55, color: '#23262b', sagFactor: 0.6, plug: 'power' },
}
export const DEFAULT_CABLE_TYPE = 'usbc'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const V3 = (x, y, z) => new THREE.Vector3(x, y, z)

// ---------- 接头库：基本体拼装，本地 +Y 为接头朝外方向，示意级、轮廓可辨 ----------
function PlugBody({ kind }) {
  switch (kind) {
    case 'usbc':
      // USB-C：小扁圆金属灰壳 + 短黑尾套
      return (
        <group>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.17, 0.21, 0.075]} />
            <meshStandardMaterial color="#9aa3ab" roughness={0.3} metalness={0.75} />
          </mesh>
          <mesh position={[0, -0.02, 0]}>
            <cylinderGeometry args={[0.052, 0.068, 0.15, 10]} />
            <meshStandardMaterial color="#33383f" roughness={0.5} metalness={0.1} />
          </mesh>
        </group>
      )
    case 'rj45':
      // 网线 RJ45：比线宽的浅灰半透长方块 + 顶部小卡扣凸起 + 蓝护套
      return (
        <group>
          <mesh position={[0, 0.14, 0]}>
            <boxGeometry args={[0.23, 0.3, 0.16]} />
            <meshStandardMaterial color="#d3dbe2" roughness={0.35} metalness={0.05} transparent opacity={0.82} />
          </mesh>
          <mesh position={[0, 0.22, 0.1]} rotation={[0.4, 0, 0]}>
            <boxGeometry args={[0.09, 0.17, 0.025]} />
            <meshStandardMaterial color="#aeb9c2" roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <cylinderGeometry args={[0.078, 0.095, 0.13, 10]} />
            <meshStandardMaterial color="#2a6fd6" roughness={0.5} />
          </mesh>
        </group>
      )
    case 'hdmi':
      // HDMI：扁宽黑梯形块（主体方块 + 前端略窄的舌片示意梯形）
      return (
        <group>
          <mesh position={[0, 0.13, 0]}>
            <boxGeometry args={[0.31, 0.3, 0.105]} />
            <meshStandardMaterial color="#23262b" roughness={0.45} metalness={0.15} />
          </mesh>
          <mesh position={[0, 0.315, 0]}>
            <boxGeometry args={[0.23, 0.08, 0.085]} />
            <meshStandardMaterial color="#101216" roughness={0.4} metalness={0.3} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <cylinderGeometry args={[0.085, 0.1, 0.1, 10]} />
            <meshStandardMaterial color="#23262b" roughness={0.5} />
          </mesh>
        </group>
      )
    case 'power':
      // 电源线：厚黑方块插头 + 两片金属插脚
      return (
        <group>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.27, 0.37, 0.2]} />
            <meshStandardMaterial color="#17191c" roughness={0.5} metalness={0.1} />
          </mesh>
          {[-0.06, 0.06].map((x) => (
            <mesh key={x} position={[x, 0.4, 0]}>
              <boxGeometry args={[0.035, 0.13, 0.018]} />
              <meshStandardMaterial color="#b9bfc6" roughness={0.3} metalness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.1, 0.115, 0.12, 10]} />
            <meshStandardMaterial color="#17191c" roughness={0.55} />
          </mesh>
        </group>
      )
    default:
      // 通用圆柱接头（v0.3 旧款，兜底）
      return (
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.09, 0.11, 0.34, 12]} />
          <meshStandardMaterial color="#33383f" roughness={0.45} metalness={0.15} />
        </mesh>
      )
  }
}

// 曲线端点接头：+Y 对齐端点切线向外（t=0 时切线反向，接头伸向曲线外侧）
function EndPlug({ curve, t, kind }) {
  const { pos, quat } = useMemo(() => {
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t).normalize()
    if (t === 0) tan.negate()
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), tan)
    return { pos: p, quat: q }
  }, [curve, t])
  return (
    <group position={pos} quaternion={quat}>
      <PlugBody kind={kind} />
    </group>
  )
}

// ---------- 线缆演示：CatmullRomCurve3 + TubeGeometry ----------
// 预设顺序即 UI「线缆形态」chip 顺序：盘绕/平盘螺旋/8字盘线/束线环/S形蛇形/垂落/悬链垂坠/直连
// v0.4 参数化：points(p)，p = { len 长度倍率, sag 垂坠 0–1, stiff 线型硬度系数 }
// 硬约束：p = { len:1, sag:0.5, stiff:任意 } 时各预设点位与 v0.3 逐点一致（已验收构图不许漂移）
const CABLE_Y = 0.075 // 平铺类线身中心高（管半径 0.055，贴地）
export const CABLE_PRESETS = {
  coil: {
    label: '盘绕',
    // over-under 上下交替盘线（影视/音频行业标准）：逐圈交替半径 ±2% 与层高微差；
    // 长度↑ → 圈径放大 + 圈数微增
    points: (p) => {
      const pts = []
      const rs = 0.72 + 0.28 * p.len
      const angMax = Math.PI * 4.2 * (0.8 + 0.2 * p.len)
      for (let i = 0; i <= 60; i++) {
        const t = i / 60
        const ang = t * angMax
        const turn = ang / (Math.PI * 2)
        const alt = Math.floor(turn) % 2 === 0 ? 1 : -1
        const r = (1.7 - 0.55 * t) * (1 + 0.02 * alt * Math.sin(Math.PI * (turn % 1))) * rs
        pts.push(V3(Math.cos(ang) * r, 0.1 + 0.28 * t + 0.012 * alt, Math.sin(ang) * r))
      }
      return pts
    },
  },
  flatspiral: {
    label: '平盘螺旋',
    // 阿基米德螺旋平铺（圈距 0.27）；内端竖起让接头朝上，外端平直尾朝外——电商主图造型
    // 长度↑ → 圈数变多（3 圈 ×(0.7+0.3·len)），螺旋自然变大
    points: (p) => {
      const pts = [V3(0.3, 0.34, 0), V3(0.31, 0.17, 0)]
      const turns = 3 * (0.7 + 0.3 * p.len)
      const rIn = 0.32
      const k = 0.27 / (Math.PI * 2) // 每弧度半径增量（圈距 0.27）
      const thMax = turns * Math.PI * 2
      const n = Math.round(26 * turns)
      for (let i = 0; i <= n; i++) {
        const th = (i / n) * thMax
        const r = rIn + k * th
        pts.push(V3(Math.cos(th) * r, CABLE_Y, Math.sin(th) * r))
      }
      const rOut = rIn + k * thMax
      pts.push(V3(rOut + 0.45, CABLE_Y, 0.05), V3(rOut + 0.9, CABLE_Y + 0.02, 0.14))
      return pts
    },
  },
  figure8: {
    label: '8字盘线',
    // Bernoulli 双纽线平铺一圈；中心交叉处第二遍高斯凸起抬高约一个线径分层防穿插；
    // 两端从中心引到前方并排。长度↑ → 整体尺度放大
    points: (p) => {
      const a = 2.6 * (0.8 + 0.2 * p.len)
      const n = 96
      const raw = []
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2
        const den = 1 + Math.cos(t) ** 2
        const lift = 0.12 * Math.exp(-(((t - Math.PI) / 0.45) ** 2))
        raw.push(V3((a * Math.sin(t)) / den, CABLE_Y + lift, (a * Math.sin(t) * Math.cos(t)) / den))
      }
      return [V3(-0.17, CABLE_Y, 1.02), V3(-0.09, CABLE_Y, 0.45), ...raw, V3(0.09, CABLE_Y, 0.45), V3(0.17, CABLE_Y, 1.02)]
    },
  },
  bundle: {
    label: '束线环',
    // 三圈贴合平环 + 前方双尾并排引出 + 扎带（strap 函数给出位置，渲染见 CableDemo）。
    // 长度↑ → 环径放大（扎带位置随 strap 同步）
    strap: (p) => ({ ang: 0.5, r: 0.86 * (0.8 + 0.2 * p.len) }),
    points: (p) => {
      const s = 0.8 + 0.2 * p.len
      const pts = [V3(-0.17, CABLE_Y, 1.78 * s), V3(-0.17, CABLE_Y, 1.2 * s)]
      const rings = [0.98, 0.855, 0.73].map((r) => r * s)
      const startAng = Math.PI / 2 + 0.55
      rings.forEach((R, ri) => {
        const steps = 30
        const sweep = ri === rings.length - 1 ? Math.PI * 2 - 1.1 : Math.PI * 2
        for (let i = ri === 0 ? 0 : 1; i <= steps; i++) {
          const ang = startAng + (i / steps) * sweep
          pts.push(V3(Math.cos(ang) * R, CABLE_Y + (ri % 2) * 0.012, Math.sin(ang) * R))
        }
      })
      pts.push(V3(0.17, CABLE_Y, 1.2 * s), V3(0.17, CABLE_Y, 1.78 * s))
      return pts
    },
  },
  serpentine: {
    label: 'S形蛇形',
    // 正弦平铺展开（straight 是其零波幅特例，视觉须明显区别）
    // 长度↑ → 波数变多（≈1.5+1.5·len 取整）且跨度微增
    points: (p) => {
      const pts = []
      const n = 84
      const span = 5.4 * (0.85 + 0.15 * p.len)
      const amp = 0.55
      const waves = Math.max(2, Math.round(1.5 + 1.5 * p.len))
      for (let i = 0; i <= n; i++) {
        const u = i / n
        pts.push(V3(-span / 2 + u * span, CABLE_Y, amp * Math.sin(u * Math.PI * 2 * waves)))
      }
      return pts
    },
  },
  drape: {
    label: '垂落',
    // 手摆垂落曲线参数化：dip = 垂坠偏离量（sag 与 len 共同作用，再乘线型硬度系数，钳制防穿地）
    // 默认 len=1/sag=0.5 时 dip=0，与 v0.3 逐点一致
    points: (p) => {
      const xs = 0.85 + 0.15 * p.len
      const dip = clamp(((p.sag - 0.5) * 1.3 + (p.len - 1) * 0.6) * p.stiff, -0.35, 0.55)
      return [
        V3(-2.4 * xs, 2.6, -0.4),
        V3(-1.4 * xs, 1.7 - dip * 0.45, 0.1),
        V3(-0.2, Math.max(0.3, 0.9 - dip), 0.45),
        V3(1.0, 1.25 - dip * 0.7, 0.35),
        V3(2.1 * xs, 2.15 - dip * 0.2, -0.1),
        V3(2.7 * xs, 2.9, -0.5),
      ]
    },
  },
  catenary: {
    label: '悬链垂坠',
    // 等高两端的真悬链线 y = yBot + a·(cosh(x/a) − 1)；垂深 depth 由 sag/len/硬度决定后二分反解 a
    // 默认（len=1, sag=0.5, stiff=1）→ depth=0.91、half=2.2、a≈2.8，与 v0.3 一致
    points: (p) => {
      const half = 2.2 * (0.85 + 0.15 * p.len)
      const top = 2.4
      const depth = clamp(0.91 * (0.35 + 1.3 * p.sag) * (0.7 + 0.3 * p.len) * p.stiff, 0.12, top - 0.25)
      let lo = 0.3
      let hi = 80
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (mid * (Math.cosh(half / mid) - 1) > depth) lo = mid
        else hi = mid
      }
      const a = (lo + hi) / 2
      const yBot = top - depth
      const n = 40
      const pts = []
      for (let i = 0; i <= n; i++) {
        const x = -half + (i / n) * half * 2
        pts.push(V3(x, yBot + a * (Math.cosh(x / a) - 1), 0))
      }
      return pts
    },
  },
  straight: {
    label: '直连',
    // 长度↑ → 横向跨度拉长
    points: (p) => {
      const xs = 0.8 + 0.2 * p.len
      return [
        V3(-2.8 * xs, 1.35, 0),
        V3(-1.2 * xs, 1.18, 0.12),
        V3(0.4 * xs, 1.16, -0.1),
        V3(2.0 * xs, 1.24, 0.08),
        V3(2.9 * xs, 1.42, 0),
      ]
    },
  },
}

export function CableDemo({ preset, type = DEFAULT_CABLE_TYPE, len = 1, sag = 0.5 }) {
  const def = CABLE_PRESETS[preset]
  const profile = CABLE_TYPES[type] ?? CABLE_TYPES[DEFAULT_CABLE_TYPE]
  const params = useMemo(
    () => ({ len, sag, stiff: profile.sagFactor }),
    [len, sag, profile],
  )
  const curve = useMemo(() => new THREE.CatmullRomCurve3(def.points(params)), [def, params])
  const geo = useMemo(
    () => new THREE.TubeGeometry(curve, 220, CABLE_BASE_RADIUS * profile.radiusMul, 10, false),
    [curve, profile],
  )
  useEffect(() => () => geo.dispose(), [geo])
  const strap = def.strap ? def.strap(params) : null
  return (
    <group>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={profile.color} roughness={0.38} metalness={0.15} />
      </mesh>
      <EndPlug curve={curve} t={0} kind={profile.plug} />
      <EndPlug curve={curve} t={1} kind={profile.plug} />
      {/* 束线环的魔术贴扎带：黑色细带，沿径向抱住线圈一侧（Joe 定：扎带基本都是黑的、比较细；
          截面厚度约为旧橙版的 40%，宽度一并收窄） */}
      {strap && (
        <mesh
          position={[Math.cos(strap.ang) * strap.r, 0.085, Math.sin(strap.ang) * strap.r]}
          rotation={[0, -strap.ang, 0]}
        >
          <boxGeometry args={[0.3, 0.185, 0.028]} />
          <meshStandardMaterial color="#17191c" roughness={0.65} metalness={0.05} />
        </mesh>
      )}
    </group>
  )
}

// ---------- 充电柜端口锚点 + 接线（v0.4，蓝图附录 B 机制验证） ----------
// 正面贴图（front.jpg 1311×1017）上 10 个充电仓一排横列（蓝色隔板可数），
// 锚点按各仓在贴图上的 u 位置（仓中心）取点、y 取仓上部，法线朝 +Z（正面外）
export const CABINET_PORTS = (() => {
  const us = [0.313, 0.374, 0.431, 0.488, 0.549, 0.606, 0.664, 0.725, 0.786, 0.839]
  return us.map((u) => V3((u - 0.5) * CABINET_SIZE.w, 2.35, CABINET_SIZE.d / 2))
})()

export function CabinetLink({ port, type = DEFAULT_CABLE_TYPE, sag = 0.5 }) {
  const profile = CABLE_TYPES[type] ?? CABLE_TYPES[DEFAULT_CABLE_TYPE]
  const anchor = CABINET_PORTS[port] ?? CABINET_PORTS[0]
  const radius = CABLE_BASE_RADIUS * profile.radiusMul
  const { curve, geo } = useMemo(() => {
    // 出线：先沿法线（+Z）出约 0.3，再按悬链式垂落到地面，末端在地面轻盘小半圈平放
    // 垂落程度由 sag × 线型硬度系数决定（柜内短线，幅度比 cable 模式 drape 收敛）
    const sway = ((port % 3) - 1) * 0.16 // 按端口序号给一点横向摆，免得每口都同一条直线
    const dip = (0.55 + sag * 0.9) * profile.sagFactor
    const x = anchor.x
    const z0 = anchor.z
    const ex = x + sway * 1.25
    const floorY = radius + 0.005
    const pts = [
      anchor.clone(),
      V3(x, anchor.y, z0 + 0.3),
      V3(x + sway * 0.4, anchor.y - 0.8 * dip, z0 + 0.52),
      V3(x + sway, anchor.y * (1 - 0.38 * dip), z0 + 0.66),
      V3(ex, 0.36, z0 + 0.8),
      V3(ex - 0.08, 0.16, z0 + 0.97),
      V3(ex + 0.16, floorY, z0 + 1.12),
      V3(ex + 0.4, floorY, z0 + 1.0),
      V3(ex + 0.48, floorY, z0 + 0.74),
      V3(ex + 0.34, floorY, z0 + 0.55),
    ]
    const c = new THREE.CatmullRomCurve3(pts)
    return { curve: c, geo: new THREE.TubeGeometry(c, 180, radius, 10, false) }
  }, [anchor, port, sag, profile, radius])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group>
      {/* 全部锚点小圆点标记，选中口高亮（曼哈顿橙） */}
      {CABINET_PORTS.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z + 0.02]}>
          <circleGeometry args={[i === port ? 0.08 : 0.05, 20]} />
          <meshBasicMaterial color={i === port ? '#e8730c' : '#cfd6dd'} transparent opacity={i === port ? 1 : 0.7} />
        </mesh>
      ))}
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={profile.color} roughness={0.38} metalness={0.15} />
      </mesh>
      {/* 起点接头：插在端口上，朝外（+Z） */}
      <group position={[anchor.x, anchor.y, anchor.z + 0.04]} rotation={[Math.PI / 2, 0, 0]}>
        <PlugBody kind={profile.plug} />
      </group>
      {/* 末端接头：落在地面线尾 */}
      <EndPlug curve={curve} t={1} kind={profile.plug} />
    </group>
  )
}

// ---------- 支架代理：基本体拼装 + ghost 屏 + 安装姿态（v0.4，蓝图附录 C） ----------
// ghost 屏尺寸档：以现面板 2.05×1.28（≈27″）为 1×，43″/55″ 等比放大
export const SCREEN_SIZES = {
  s27: { label: '27″', sub: '显示器', w: 2.13, h: 1.34 },
  s43: { label: '43″', sub: '电视', w: 3.27, h: 2.04 },
  s55: { label: '55″', sub: '电视', w: 4.19, h: 2.62 },
}
export const MOUNT_POSES = {
  desk: { label: '桌面式' },
  wall: { label: '壁挂式' },
  arm: { label: '臂展式' },
}

export function MountProxy({ armAngle, tiltAngle, pose = 'desk', screenSize = 's27' }) {
  const armRad = THREE.MathUtils.degToRad(armAngle) // 臂抬升角（相对水平）
  const tiltRad = THREE.MathUtils.degToRad(tiltAngle)
  const armLen = 1.5
  const pivot = new THREE.Vector3(-0.55, 1.85, 0)
  // 臂末端 = 枢轴 + 臂长沿抬升方向（与臂 group 的 rotation.z 严格同式，保证面板与臂端严丝合缝）
  const tip = new THREE.Vector3(
    pivot.x + armLen * Math.cos(armRad),
    pivot.y + armLen * Math.sin(armRad),
    0,
  )
  const scr = SCREEN_SIZES[screenSize] ?? SCREEN_SIZES.s27
  // 屏体缩放系数（以 27″ 档为 1）：边框体/显示面必须与 ghost 屏按同一 k 等比缩放，
  // 否则切大尺寸时只有 ghost 板变大、屏本体停在 27″，看起来像多出一块错位斜板
  const scrK = scr.w / SCREEN_SIZES.s27.w
  const wallPose = pose === 'wall'
  return (
    <group>
      {!wallPose && (
        <>
          {/* 底座 */}
          <RoundedBox args={[1.7, 0.09, 1.15]} radius={0.04} position={[0, 0.045, 0]}>
            <meshStandardMaterial color="#3a3f45" roughness={0.5} metalness={0.4} />
          </RoundedBox>
          {/* 立柱 */}
          <mesh position={[pivot.x, pivot.y / 2, 0]}>
            <boxGeometry args={[0.2, pivot.y, 0.2]} />
            <meshStandardMaterial color="#4a5058" roughness={0.45} metalness={0.5} />
          </mesh>
        </>
      )}
      {wallPose && (
        <>
          {/* ghost 墙：半透明大竖面，交代墙面位置（屏与之平行）
              noFit：自动取景只量支架产品主体，跳过 ghost 辅助对象；
              noExport：干净图/深度图导出时隐藏（ghost 不入成品交接包，成品图仍保留） */}
          <group userData={{ noFit: true, noExport: true }}>
            <mesh position={[0.35, 1.8, -0.62]}>
              <planeGeometry args={[6.6, 3.9]} />
              <meshStandardMaterial color="#93a7c0" roughness={0.9} metalness={0} transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          </group>
          {/* 墙板：贴墙的安装板 + 向屏方向的支臂座 */}
          <mesh position={[pivot.x, pivot.y, -0.56]}>
            <boxGeometry args={[0.46, 0.8, 0.07]} />
            <meshStandardMaterial color="#2c3036" roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[pivot.x, pivot.y, -0.3]}>
            <boxGeometry args={[0.13, 0.13, 0.52]} />
            <meshStandardMaterial color="#4a5058" roughness={0.45} metalness={0.5} />
          </mesh>
        </>
      )}
      {/* 枢轴关节球 */}
      <mesh position={pivot}>
        <sphereGeometry args={[0.17, 20, 16]} />
        <meshStandardMaterial color="#23262b" roughness={0.4} metalness={0.5} />
      </mesh>
      {/* 臂：绕枢轴 Z 轴抬升，臂体沿本地 +X */}
      <group position={pivot} rotation={[0, 0, armRad]}>
        <mesh position={[armLen / 2, 0, 0]}>
          <boxGeometry args={[armLen, 0.16, 0.14]} />
          <meshStandardMaterial color="#4a5058" roughness={0.45} metalness={0.5} />
        </mesh>
        <mesh position={[armLen, 0, 0]}>
          <sphereGeometry args={[0.13, 18, 14]} />
          <meshStandardMaterial color="#23262b" roughness={0.4} metalness={0.5} />
        </mesh>
      </group>
      {/* 面板（VESA 安装座）：挂在臂末端，绕 Z 俯仰；ghost 屏贴合其上、随之同动 */}
      <group position={[tip.x + 0.12, tip.y + 0.1, 0]} rotation={[0, 0, tiltRad]}>
        {/* 屏框体与显示面随尺寸档等比放大（×scrK），与下方 ghost 屏同心同比例 */}
        <RoundedBox args={[2.05 * scrK, 1.28 * scrK, 0.07]} radius={0.03}>
          <meshStandardMaterial color="#101216" roughness={0.35} metalness={0.3} />
        </RoundedBox>
        <mesh position={[0, 0, 0.045]}>
          <planeGeometry args={[1.9 * scrK, 1.13 * scrK]} />
          <meshStandardMaterial color="#274b73" roughness={0.25} metalness={0.2} />
        </mesh>
        {/* VESA 背板示意 */}
        <mesh position={[0, 0, -0.07]}>
          <boxGeometry args={[0.5, 0.5, 0.06]} />
          <meshStandardMaterial color="#2c3036" roughness={0.5} metalness={0.4} />
        </mesh>
        {/* ghost 显示设备：半透明屏体，只示意尺寸与安装关系，永远贴在面板正前方
            noFit：自动取景跳过 ghost 屏，只量支架产品主体；
            noExport：干净图/深度图导出时隐藏 */}
        <group userData={{ noFit: true, noExport: true }}>
          <RoundedBox args={[scr.w, scr.h, 0.09]} radius={0.03} position={[0, 0, 0.03]}>
            <meshStandardMaterial color="#a9bfd8" roughness={0.15} metalness={0.1} transparent opacity={0.3} depthWrite={false} />
          </RoundedBox>
        </group>
      </group>
    </group>
  )
}
