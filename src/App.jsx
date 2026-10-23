import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import {
  CabinetBox,
  CabinetLink,
  CableDemo,
  CABLE_PRESETS,
  CABLE_TYPES,
  MountProxy,
  SCREEN_SIZES,
  MOUNT_POSES,
} from './components/Objects'
import { CanvasErrorBoundary } from './components/ErrorBoundary'
import { CameraRig, RigRegistrar } from './components/CameraRig'
import { CAMERA_PRESETS, FOCALS, focalToFov, deg2rad } from './lib/camera'
import {
  exportRenderPNG,
  exportDepthPNG,
  exportCameraJSON,
  exportAIBundle,
  buildCameraParams,
} from './lib/exporter'

// ---------- 按对象取景表（切换对象时相机注视点 + 距离倍率自动适配） ----------
// dist 是相对机位预设基准距离的倍率；目标是产品居中、占画布约 55–70%、四边留白均衡
const FRAMING = {
  cabinet: { target: [0, 1.45, 0], dist: 1.3 },
  mount: { target: [0.45, 1.55, 0], dist: 0.95 },
}
// 支架按安装姿态取景：臂展式屏更高更远、壁挂式带墙需拉远防溢出
const MOUNT_FRAMING = {
  desk: { target: [0.45, 1.55, 0], dist: 0.95 },
  wall: { target: [0.35, 1.75, 0], dist: 1.12 },
  arm: { target: [0.5, 2.0, 0], dist: 1.02 },
}
// 姿态预设的关节角：切姿态时写入滑杆值，用户之后仍可拖滑杆微调
const POSE_JOINTS = {
  desk: { arm: 28, tilt: 8 },
  wall: { arm: 12, tilt: 0 },
  arm: { arm: 52, tilt: 20 },
}
const CABLE_FRAMING = {
  // 倍率按线缆包围盒宽度反推（看图员复验：0.68/0.78/0.80 时 drape 右端被裁出画布）：
  // drape 横向跨度约 5.1、straight 约 5.8，需可见宽度 ≥6.5 → 距离倍率约 1.0–1.1
  coil: { target: [0, 0.25, 0], dist: 0.82 },
  // v0.3 新增 5 预设：target 按各自包围盒中心、dist 按跨度反推至占幅约 60–70%；
  // 平铺类（贴地）注视点 y 取小值，悬空类按其竖直中心；3/4 透视近端偏大时沿相机右轴微补偿
  flatspiral: { target: [0.35, 0.15, 0], dist: 0.74 },
  figure8: { target: [0.35, 0.2, 0.1], dist: 1.15 },
  bundle: { target: [0.05, 0.15, 0.4], dist: 0.7 },
  serpentine: { target: [0.25, 0.3, -0.2], dist: 1.08 },
  // drape/straight 二次复验：接头已全入画但整体右偏（右接头距右缘仅约 47px）——
  // 右端接头离相机更近、透视放大所致；注视点沿相机右轴补偿约 0.6/0.36 单位并略增距离
  drape: { target: [0.6, 1.8, -0.4], dist: 1.06 },
  catenary: { target: [0.3, 1.8, -0.15], dist: 1.0 },
  straight: { target: [0.27, 1.3, -0.24], dist: 1.1 },
}
function getFraming(mode, cablePreset, mountPose = 'desk') {
  if (mode === 'cable') return CABLE_FRAMING[cablePreset]
  if (mode === 'mount') return MOUNT_FRAMING[mountPose] ?? FRAMING.mount
  return FRAMING[mode]
}

const MODES = [
  { key: 'cabinet', name: '充电柜', sub: '贴图盒子' },
  { key: 'cable', name: '线缆', sub: '管线代理' },
  { key: 'mount', name: '支架', sub: '基本体代理' },
]

function fmt(v, digits = 0) {
  return v == null || Number.isNaN(v) ? '––' : Number(v).toFixed(digits)
}

export default function App() {
  const rigRef = useRef({})
  const groundRef = useRef(null) // 影棚地面组（光池圆盘+阴影面），AI 交接包导出时整体隐藏
  const controlsRef = useRef(null)
  // 支持 URL 参数直达演示对象（如 ?mode=cable&cable=coil），方便分享/验收定位
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const initialMode = MODES.some((m) => m.key === urlParams.get('mode'))
    ? urlParams.get('mode')
    : 'cabinet'
  const initialCable = CABLE_PRESETS[urlParams.get('cable')] ? urlParams.get('cable') : 'drape'

  const [mode, setMode] = useState(initialMode)
  const [presetName, setPresetName] = useState('three_quarter')
  const [cablePreset, setCablePreset] = useState(initialCable)
  // v0.4 线缆参数化与线型档案（默认值 = v0.3 现貌：长度 1.0、垂坠 0.5、线型 USB-C）
  const [cableType, setCableType] = useState('usbc')
  const [cableLen, setCableLen] = useState(1.0)
  const [cableSag, setCableSag] = useState(0.5)
  // v0.4 充电柜端口锚点接线
  const [linkOn, setLinkOn] = useState(false)
  const [linkPort, setLinkPort] = useState(4)
  // v0.4 支架安装姿态与 ghost 屏尺寸
  const [mountPose, setMountPose] = useState('desk')
  const [screenSize, setScreenSize] = useState('s27')
  const [armAngle, setArmAngle] = useState(28)
  const [tiltAngle, setTiltAngle] = useState(8)
  const [canvasError, setCanvasError] = useState(null)
  const [showHint, setShowHint] = useState(true)
  const [copied, setCopied] = useState(false)

  const framing = useMemo(
    () => getFraming(mode, cablePreset, mountPose),
    [mode, cablePreset, mountPose],
  )
  const targetVec = useMemo(() => new THREE.Vector3(...framing.target), [framing])

  const initial = CAMERA_PRESETS.three_quarter
  const [camCmd, setCamCmd] = useState(() => {
    const f = getFraming(initialMode, initialCable)
    return {
      azimuthDeg: initial.azimuthDeg,
      elevationDeg: initial.elevationDeg,
      distance: initial.distance * f.dist,
      focalMm: 50,
      seq: 0,
    }
  })
  const [camParams, setCamParams] = useState(null)

  useEffect(() => { window.__rigRef = rigRef }, []) // 无头验收/调试入口
  const extra = useMemo(
    () => ({ object_mode: mode, camera_preset: presetName }),
    [mode, presetName],
  )

  // 面板上的机位参数与真实相机同步（轮询 300ms，原型够用）
  useEffect(() => {
    const id = setInterval(() => {
      const p = buildCameraParams(rigRef.current, targetVec, extra)
      if (p) setCamParams(p)
    }, 300)
    return () => clearInterval(id)
  }, [targetVec, extra])

  // 切换对象/线缆形态时按取景表重新取景（保留当前预设角度与焦段，只改注视点+距离）
  const presetRef = useRef(presetName)
  presetRef.current = presetName
  useEffect(() => {
    const p = CAMERA_PRESETS[presetRef.current]
    setCamCmd((prev) => ({
      azimuthDeg: p.azimuthDeg,
      elevationDeg: p.elevationDeg,
      distance: p.distance * framing.dist * (prev.focalMm / 50),
      focalMm: prev.focalMm,
      seq: prev.seq + 1,
    }))
  }, [framing])

  const goPreset = useCallback(
    (name) => {
      const p = CAMERA_PRESETS[name]
      setPresetName(name)
      setCamCmd((prev) => ({
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        // 预设距离以 50mm 为基准，按焦段比例与对象取景倍率换算保持构图
        distance: p.distance * framing.dist * (prev.focalMm / 50),
        focalMm: prev.focalMm,
        seq: prev.seq + 1,
      }))
    },
    [framing],
  )

  const setFocal = useCallback((f) => {
    setCamCmd((prev) => ({
      ...prev,
      focalMm: f,
      distance: prev.distance * (f / prev.focalMm), // 换焦段同步变距，产品占比大致不变
      seq: prev.seq + 1,
    }))
  }, [])

  const switchMode = useCallback((m) => {
    setCanvasError(null)
    setMode(m)
  }, [])

  // 切安装姿态：姿态预设的关节角写入滑杆（之后用户可再微调）
  const applyPose = useCallback((p) => {
    setMountPose(p)
    const j = POSE_JOINTS[p]
    if (j) {
      setArmAngle(j.arm)
      setTiltAngle(j.tilt)
    }
  }, [])

  const sagEnabled = cablePreset === 'drape' || cablePreset === 'catenary'

  const copyJSON = useCallback(async () => {
    if (!camParams) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(camParams, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用时静默，仍可下载 */ }
  }, [camParams])

  const presetLabel = CAMERA_PRESETS[presetName]?.label ?? ''
  const modeLabel = MODES.find((m) => m.key === mode)?.name ?? ''

  return (
    <div className="layout">
      <aside className="panel">
        <div className="panel-body">
          <header className="panel-head">
            <h1>3D 虚拟摄影棚 <span className="sub">原型 v0.4</span></h1>
            <p className="prodline">MANHATTAN · INTELLINET 产品出图工作台</p>
          </header>

          <section>
            <h2><span className="step">1</span>选择对象</h2>
            <div className="chips3">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  className={`chip ${mode === m.key ? 'on' : ''}`}
                  onClick={() => switchMode(m.key)}
                >
                  <b>{m.name}</b>
                  <small>{m.sub}</small>
                </button>
              ))}
            </div>

            {mode === 'cabinet' && (
              <>
                <h3>线缆连接</h3>
                <div className="chips2">
                  <button className={!linkOn ? 'on' : ''} onClick={() => setLinkOn(false)}>不接线</button>
                  <button className={linkOn ? 'on' : ''} onClick={() => setLinkOn(true)}>接线</button>
                </div>
                {linkOn && (
                  <>
                    <h3>端口（正面 10 口）</h3>
                    <div className="chips5">
                      {Array.from({ length: 10 }, (_, i) => (
                        <button
                          key={i}
                          className={linkPort === i ? 'on' : ''}
                          onClick={() => setLinkPort(i)}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <h3>线型</h3>
                    <div className="chips4">
                      {Object.entries(CABLE_TYPES).map(([k, v]) => (
                        <button
                          key={k}
                          className={cableType === k ? 'on' : ''}
                          onClick={() => setCableType(k)}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                    <div className="sliders">
                      <label>
                        <span>垂坠</span><em>{cableSag.toFixed(2)}</em>
                        <input
                          type="range" min={0} max={1} step={0.01} value={cableSag}
                          onChange={(e) => setCableSag(+e.target.value)}
                        />
                      </label>
                    </div>
                  </>
                )}
              </>
            )}
            {mode === 'cable' && (
              <>
                <h3>线缆形态</h3>
                <div className="chips3">
                  {Object.entries(CABLE_PRESETS).map(([k, v]) => (
                    <button
                      key={k}
                      className={cablePreset === k ? 'on' : ''}
                      onClick={() => setCablePreset(k)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <h3>线型</h3>
                <div className="chips4">
                  {Object.entries(CABLE_TYPES).map(([k, v]) => (
                    <button
                      key={k}
                      className={cableType === k ? 'on' : ''}
                      onClick={() => setCableType(k)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <h3>线缆参数</h3>
                <div className="sliders">
                  <label>
                    <span>长度</span><em>×{cableLen.toFixed(2)}</em>
                    <input
                      type="range" min={0.7} max={1.6} step={0.01} value={cableLen}
                      onChange={(e) => setCableLen(+e.target.value)}
                    />
                  </label>
                  <label className={sagEnabled ? '' : 'off'}>
                    <span>垂坠</span><em>{cableSag.toFixed(2)}</em>
                    <input
                      type="range" min={0} max={1} step={0.01} value={cableSag}
                      disabled={!sagEnabled}
                      onChange={(e) => setCableSag(+e.target.value)}
                    />
                  </label>
                </div>
                {!sagEnabled && <p className="hint">垂坠仅对垂落 / 悬链垂坠生效。</p>}
              </>
            )}
            {mode === 'mount' && (
              <>
                <h3>安装姿态</h3>
                <div className="chips3">
                  {Object.entries(MOUNT_POSES).map(([k, v]) => (
                    <button
                      key={k}
                      className={mountPose === k ? 'on' : ''}
                      onClick={() => applyPose(k)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <h3>显示设备（ghost 屏）</h3>
                <div className="chips3">
                  {Object.entries(SCREEN_SIZES).map(([k, v]) => (
                    <button
                      key={k}
                      className={`chip ${screenSize === k ? 'on' : ''}`}
                      onClick={() => setScreenSize(k)}
                    >
                      <b>{v.label}</b>
                      <small>{v.sub}</small>
                    </button>
                  ))}
                </div>
                <h3>支架姿态</h3>
                <div className="sliders">
                  <label>
                    <span>臂摆角</span><em>{armAngle}°</em>
                    <input
                      type="range" min={-25} max={60} value={armAngle}
                      onChange={(e) => setArmAngle(+e.target.value)}
                    />
                  </label>
                  <label>
                    <span>面板俯仰</span><em>{tiltAngle}°</em>
                    <input
                      type="range" min={-25} max={35} value={tiltAngle}
                      onChange={(e) => setTiltAngle(+e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
          </section>

          <section>
            <h2><span className="step">2</span>机位与镜头</h2>
            <h3>机位预设</h3>
            <div className="chips3">
              {Object.entries(CAMERA_PRESETS).map(([k, v]) => (
                <button
                  key={k}
                  className={presetName === k ? 'on' : ''}
                  onClick={() => goPreset(k)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <h3>等效焦段（全画幅换算）</h3>
            <div className="seg">
              {FOCALS.map((f) => (
                <button
                  key={f}
                  className={camCmd.focalMm === f ? 'on' : ''}
                  onClick={() => setFocal(f)}
                >
                  {f}mm
                </button>
              ))}
            </div>
            <p className="hint">也可以直接拖动画面旋转、滚轮缩放；角度已限制在方位 ±65°、俯角 5°–60°。</p>

            <h3>当前机位</h3>
            <div className="metrics">
              <div className="metric"><span>方位角</span><b>{fmt(camParams?.azimuth_deg)}°</b></div>
              <div className="metric"><span>俯仰角</span><b>{fmt(camParams?.elevation_deg)}°</b></div>
              <div className="metric"><span>等效焦段</span><b>{fmt(camParams?.focal_equiv_mm)}<small> mm</small></b></div>
              <div className="metric"><span>相机距离</span><b>{fmt(camParams?.distance, 1)}</b></div>
            </div>
            <details className="rawjson">
              <summary>原始数据 JSON（调试 / 下载用）</summary>
              <pre className="json">{camParams ? JSON.stringify(camParams, null, 2) : '相机初始化中…'}</pre>
              <button className="mini" onClick={copyJSON}>{copied ? '已复制 ✓' : '复制 JSON'}</button>
            </details>
          </section>
        </div>

        <footer className="panel-foot">
          <h2><span className="step">3</span>导出成品</h2>
          <button className="primary" onClick={() => exportRenderPNG(rigRef.current)}>
            导出渲染图 PNG<span className="psub">白底 1400×1050</span>
          </button>
          <div className="subrow">
            <button onClick={() => exportDepthPNG(rigRef.current, targetVec)}>深度图 PNG</button>
            <button onClick={() => exportCameraJSON(rigRef.current, targetVec, extra)}>机位参数 JSON</button>
          </div>
          <div className="airow">
            <button onClick={() => exportAIBundle(rigRef.current, groundRef.current, targetVec, extra)}>
              AI 交接包 · 干净版
            </button>
            <p className="hint">无地面、无阴影，给生图 AI 用：干净渲染图 + 深度图 + 机位参数。浏览器若拦截多文件下载请允许。</p>
          </div>
        </footer>
      </aside>

      <main className="stage" onPointerDown={() => setShowHint(false)}>
        {canvasError && (
          <div className="errbar">3D 内容加载失败：{String(canvasError.message || canvasError)}（请截图这条信息反馈）</div>
        )}
        <div className="hud">
          <b>{modeLabel} · {presetLabel}</b>
          <span>方位 {fmt(camParams?.azimuth_deg)}° · 俯仰 {fmt(camParams?.elevation_deg)}° · {fmt(camParams?.focal_equiv_mm)}mm</span>
        </div>
        {showHint && (
          <div className="hintpill">
            <span>拖动旋转 · 滚轮 / 双指缩放 · 点左侧预设换机位</span>
            <button onClick={() => setShowHint(false)}>知道了</button>
          </div>
        )}
        <Canvas
          dpr={[1, 2]}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ position: [4.6, 3.1, 6.9], fov: focalToFov(50), near: 0.1, far: 100 }}
          shadows
        >
          {/* 影棚背景不用纯色：透明画布透出 .stage 的深色径向渐变（无缝背景纸感） */}
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 9, 4]} intensity={1.55} castShadow shadow-mapSize={[2048, 2048]} />
          <directionalLight position={[-6, 3.5, -5]} intensity={0.5} color="#bcd0ff" />

          <Suspense
            fallback={
              <Html center>
                <div className="loadcard"><i className="spin" />正在加载产品贴图…</div>
              </Html>
            }
          >
            <CanvasErrorBoundary key={mode} onError={(e) => setCanvasError(e)}>
              {mode === 'cabinet' && (
                <>
                  <CabinetBox />
                  {linkOn && <CabinetLink port={linkPort} type={cableType} sag={cableSag} />}
                </>
              )}
              {mode === 'cable' && (
                <CableDemo preset={cablePreset} type={cableType} len={cableLen} sag={cableSag} />
              )}
              {mode === 'mount' && (
                <MountProxy armAngle={armAngle} tiltAngle={tiltAngle} pose={mountPose} screenSize={screenSize} />
              )}
            </CanvasErrorBoundary>
          </Suspense>

          {/* 影棚地面：一张光池圆盘 + 一层只接阴影的透明面（柔和接触阴影，无网格无灰带）。
              包进 group 以便 AI 交接包导出时整体隐藏（干净版无地面无阴影） */}
          <group ref={groundRef}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
              <circleGeometry args={[4.8, 48]} />
              <meshStandardMaterial color="#2b3038" roughness={1} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
              <planeGeometry args={[40, 40]} />
              <shadowMaterial opacity={0.34} />
            </mesh>
          </group>

          <RigRegistrar rigRef={rigRef} />
          <CameraRig camCmd={camCmd} target={framing.target} controlsRef={controlsRef} rigRef={rigRef} />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={framing.target}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.45}
            zoomSpeed={0.75}
            minDistance={3.5}
            maxDistance={20}
            minPolarAngle={deg2rad(30)} // 俯角上限 60°
            maxPolarAngle={deg2rad(85)} // 俯角下限 5°
            minAzimuthAngle={deg2rad(-65)}
            maxAzimuthAngle={deg2rad(65)}
            onStart={() => rigRef.current?.cancelAnim?.()}
          />
        </Canvas>
      </main>
    </div>
  )
}
