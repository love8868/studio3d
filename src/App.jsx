import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
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
import { CAMERA_PRESETS, FOCALS, focalToFov, deg2rad, describeCamera } from './lib/camera'
import { measureSubject, fitDistance } from './lib/framing'
import {
  exportRenderPNG,
  exportDepthPNG,
  exportCameraJSON,
  exportAIBundle,
  buildCameraParams,
} from './lib/exporter'

// ---------- 自动取景（fit-to-object） ----------
// 取代写死的按对象取景倍率：用主体包围盒反推距离，target 取包围盒中心。
// margin 为有效 FOV 收窄比例：每边留白 = margin/2，0.18 ≈ 四边各约 9% 余量（规格 8–12%）。
const FIT_MARGIN = 0.18
const ASPECT = 4 / 3 // 预览 / 渲染 / 深度统一 4:3 口径

// 姿态预设的关节角：切姿态时写入滑杆值，用户之后仍可拖滑杆微调
const POSE_JOINTS = {
  desk: { arm: 28, tilt: 8 },
  wall: { arm: 12, tilt: 0 },
  arm: { arm: 52, tilt: 20 },
}

const MODES = [
  { key: 'cabinet', name: '充电柜', sub: '贴图盒子' },
  { key: 'cable', name: '线缆', sub: '管线代理' },
  { key: 'mount', name: '支架', sub: '基本体代理' },
]

function fmt(v, digits = 0) {
  return v == null || Number.isNaN(v) ? '––' : Number(v).toFixed(digits)
}

// 首帧渲染完成探针：Suspense 内贴图解析后本组件才挂载，useFrame 第一次触发即首帧渲完 → 通知外层收起加载浮层。
// 不用 gl 的 onCreated（那时贴图还没加载，会过早收起）。
function SceneReady({ onReady }) {
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    done.current = true
    onReady?.()
  })
  return null
}

export default function App() {
  const rigRef = useRef({})
  const groundRef = useRef(null) // 影棚地面组（光池圆盘 + 阴影面），干净版/AI 包导出时整体隐藏
  const discRef = useRef(null) // 光池圆盘，白底渲染图导出时单独隐藏（保留接地阴影面）
  const subjectRef = useRef(null) // 当前对象组（自动取景量包围盒用）
  const controlsRef = useRef(null)
  const stageRef = useRef(null)
  const suppressFitRef = useRef(false) // 导入机位时抑制一次自动 re-fit

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
  const [transparent, setTransparent] = useState(false) // 干净 PNG 透明底（默认关）
  const [frame, setFrame] = useState({ w: 0, h: 0 }) // 4:3 取景框尺寸
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState(null)
  const [sceneReady, setSceneReady] = useState(false) // 首帧场景就绪前显示 DOM 加载浮层

  const modeRef = useRef(mode)
  modeRef.current = mode

  const pres = CAMERA_PRESETS.three_quarter
  const [camCmd, setCamCmd] = useState(() => ({
    azimuthDeg: pres.azimuthDeg,
    elevationDeg: pres.elevationDeg,
    distance: 12,
    focalMm: 50,
    target: [0, 1.5, 0],
    seq: 0,
  }))
  const [camParams, setCamParams] = useState(null)

  const camCmdRef = useRef(camCmd)
  camCmdRef.current = camCmd
  const targetVec = useMemo(() => new THREE.Vector3(...camCmd.target), [camCmd.target])
  const extra = useMemo(
    () => ({ object_mode: mode, camera_preset: presetName }),
    [mode, presetName],
  )

  useEffect(() => {
    window.__rigRef = rigRef
  }, []) // 无头验收/调试入口

  // --- 4:3 取景框：stage 内留 16px 边距，min 适配，短/窄窗口不溢出 ---
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = Math.max(0, Math.min(r.width - 32, (r.height - 32) * ASPECT))
      setFrame({ w, h: (w * 3) / 4 })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- 自动取景：按当前角度/焦段重算距离与 target，并驱动相机动画 ---
  const applyAim = useCallback((azDeg, elDeg, focalMm) => {
    const camera = rigRef.current?.camera
    const subject = subjectRef.current
    let distance = null
    let target = null
    if (camera && subject) {
      const box = measureSubject(subject)
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        distance = fitDistance({
          aspect: camera.aspect || ASPECT,
          fovDeg: focalToFov(focalMm),
          azimuthDeg: azDeg,
          elevationDeg: elDeg,
          box,
          center,
          margin: FIT_MARGIN,
        })
        target = [center.x, center.y, center.z]
      }
    }
    setCamCmd((prev) => ({
      azimuthDeg: azDeg,
      elevationDeg: elDeg,
      focalMm,
      distance: distance ?? prev.distance,
      target: target ?? prev.target,
      seq: prev.seq + 1,
    }))
  }, [])

  const refit = useCallback(() => {
    const c = camCmdRef.current
    applyAim(c.azimuthDeg, c.elevationDeg, c.focalMm)
  }, [applyAim])

  // 「适配画面」：按用户当前实际视角（OrbitControls 拖动后的真实相机方位/俯仰）重新取景，
  // 而不是 camCmd 里记录的上一次角度
  const fitCurrent = useCallback(() => {
    const camera = rigRef.current?.camera
    if (!camera) return
    const p = describeCamera(camera, targetVec)
    setPresetName('custom') // 按当前实际视角取景后不再属于任何预设
    applyAim(p.azimuth_deg, p.elevation_deg, camCmdRef.current.focalMm)
  }, [applyAim, targetVec])

  // 模式/形态切换后，待主体挂载完成再自动取景（Suspense 贴图加载完成前 subjectRef 为空）
  useEffect(() => {
    let cancelled = false
    let tries = 0
    const id = setInterval(() => {
      if (cancelled) return
      if (subjectRef.current && rigRef.current?.camera) {
        clearInterval(id)
        if (suppressFitRef.current) {
          suppressFitRef.current = false // 导入机位时消费掉一次自动 re-fit
          return
        }
        refit()
      } else if (++tries > 60) {
        clearInterval(id)
      }
    }, 120)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mode, cablePreset, mountPose, screenSize, linkOn, refit])

  // 面板上的机位参数与真实相机同步（轮询 300ms，原型够用）
  useEffect(() => {
    const id = setInterval(() => {
      const p = buildCameraParams(rigRef.current, targetVec, extra, { transparent })
      if (p) setCamParams(p)
    }, 300)
    return () => clearInterval(id)
  }, [targetVec, extra, transparent])

  const goPreset = useCallback(
    (name) => {
      const p = CAMERA_PRESETS[name]
      setPresetName(name)
      applyAim(p.azimuthDeg, p.elevationDeg, camCmdRef.current.focalMm)
    },
    [applyAim],
  )

  const setFocal = useCallback(
    (f) => {
      const c = camCmdRef.current
      applyAim(c.azimuthDeg, c.elevationDeg, f)
    },
    [applyAim],
  )

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
    } catch {
      /* 剪贴板不可用时静默，仍可下载 */
    }
  }, [camParams])

  // --- 导入机位 JSON：校验 schema，恢复 az/el/focal/distance/target/mode/preset 并 snap ---
  const restoreCamera = useCallback((obj) => {
    if (!obj || typeof obj !== 'object') {
      setImportMsg({ ok: false, text: '无法解析 JSON 对象。' })
      return
    }
    // 兼容旧 JSON：无 schema 但含 az/el/target 时按旧版恢复；仅当 schema 存在且不是本工具版本才报错
    const schema = obj.schema == null ? '' : String(obj.schema)
    const legacy = schema === ''
    if (!legacy && !schema.startsWith('studio3d/camera@')) {
      setImportMsg({ ok: false, text: `schema 不匹配（需要 studio3d/camera@1）：${schema}` })
      return
    }
    const az = Number(obj.azimuth_deg)
    const el = Number(obj.elevation_deg)
    const focal = Number(obj.focal_equiv_mm ?? obj.focal_mm ?? 50)
    const dist = Number(obj.distance_to_target ?? obj.distance)
    const tgt = Array.isArray(obj.target) ? obj.target.map(Number) : null
    if (
      ![az, el, focal, dist].every(Number.isFinite) ||
      !tgt ||
      tgt.length !== 3 ||
      !tgt.every(Number.isFinite)
    ) {
      setImportMsg({
        ok: false,
        text: '机位字段缺失或非法（需要 azimuth_deg / elevation_deg / focal_equiv_mm / distance / target）。',
      })
      return
    }
    const modeKey = MODES.some((m) => m.key === obj.object_mode) ? obj.object_mode : null
    const presetKey = CAMERA_PRESETS[obj.camera_preset] ? obj.camera_preset : null
    // 仅在「导入会切换模式」时抑制一次自动 re-fit（该 re-fit 会覆盖导入的 target/distance）；
    // 抑制标志由模式切换后的取景 watcher 消费，避免被时间竞态误伤
    if (modeKey && modeKey !== modeRef.current) suppressFitRef.current = true
    setCanvasError(null)
    if (modeKey) setMode(modeKey)
    if (presetKey) setPresetName(presetKey)
    else if (obj.camera_preset === 'custom') setPresetName('custom')
    setCamCmd((prev) => ({
      azimuthDeg: az,
      elevationDeg: el,
      focalMm: focal,
      distance: dist,
      target: tgt,
      seq: prev.seq + 1,
    }))
    setImportMsg({
      ok: true,
      text: `${legacy ? '旧版 JSON，已恢复' : '已恢复机位'}：方位 ${az}° · 俯仰 ${el}° · ${focal}mm`,
    })
    // 动画首帧建立后再 snap，确保精确落位
    setTimeout(() => rigRef.current?.snap?.(), 80)
  }, [])

  const parseAndRestore = useCallback(
    (text) => {
      try {
        restoreCamera(JSON.parse(text))
      } catch {
        setImportMsg({ ok: false, text: 'JSON 解析失败，请检查内容。' })
      }
    },
    [restoreCamera],
  )

  const onImportFile = useCallback(
    (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => parseAndRestore(String(reader.result))
      reader.onerror = () => setImportMsg({ ok: false, text: '文件读取失败。' })
      reader.readAsText(file)
    },
    [parseAndRestore],
  )

  const presetLabel = CAMERA_PRESETS[presetName]?.label ?? (presetName === 'custom' ? '自定义' : '')
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
                  aria-pressed={mode === m.key}
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
                  <button
                    className={!linkOn ? 'on' : ''}
                    aria-pressed={!linkOn}
                    onClick={() => setLinkOn(false)}
                  >
                    不接线
                  </button>
                  <button
                    className={linkOn ? 'on' : ''}
                    aria-pressed={linkOn}
                    onClick={() => setLinkOn(true)}
                  >
                    接线
                  </button>
                </div>
                {linkOn && (
                  <>
                    <h3>端口（正面 10 口）</h3>
                    <div className="chips5">
                      {Array.from({ length: 10 }, (_, i) => (
                        <button
                          key={i}
                          className={linkPort === i ? 'on' : ''}
                          aria-pressed={linkPort === i}
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
                          aria-pressed={cableType === k}
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
                          aria-label="垂坠"
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
                      aria-pressed={cablePreset === k}
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
                      aria-pressed={cableType === k}
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
                      aria-label="长度"
                      onChange={(e) => setCableLen(+e.target.value)}
                    />
                  </label>
                  <label className={sagEnabled ? '' : 'off'}>
                    <span>垂坠</span><em>{cableSag.toFixed(2)}</em>
                    <input
                      type="range" min={0} max={1} step={0.01} value={cableSag}
                      aria-label="垂坠"
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
                      aria-pressed={mountPose === k}
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
                      aria-pressed={screenSize === k}
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
                      aria-label="臂摆角"
                      onChange={(e) => setArmAngle(+e.target.value)}
                    />
                  </label>
                  <label>
                    <span>面板俯仰</span><em>{tiltAngle}°</em>
                    <input
                      type="range" min={-25} max={35} value={tiltAngle}
                      aria-label="面板俯仰"
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
                  aria-pressed={presetName === k}
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
                  aria-pressed={camCmd.focalMm === f}
                  onClick={() => setFocal(f)}
                >
                  {f}mm
                </button>
              ))}
            </div>
            <div className="fitrow">
              <button className="mini" onClick={fitCurrent}>适配画面</button>
            </div>
            <p className="hint">也可以直接拖动画面旋转、滚轮缩放；角度已限制在方位 ±65°、仰角 5°–60°。</p>

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

            <details className="importblock">
              <summary>导入机位 JSON（复现机位）</summary>
              <input
                type="file"
                accept="application/json,.json"
                aria-label="选择机位 JSON 文件"
                onChange={onImportFile}
              />
              <textarea
                value={importText}
                aria-label="粘贴机位 JSON"
                placeholder="或粘贴机位 JSON 到此处…"
                onChange={(e) => setImportText(e.target.value)}
              />
              <button className="mini" onClick={() => parseAndRestore(importText)}>恢复机位</button>
              {importMsg && (
                <p className={importMsg.ok ? 'hint okmsg' : 'hint errmsg'}>{importMsg.text}</p>
              )}
            </details>
          </section>
        </div>

        <footer className="panel-foot">
          <h2><span className="step">3</span>导出成品</h2>
          <button
            className="primary"
            onClick={() =>
              exportRenderPNG(rigRef.current, { disc: discRef.current, target: targetVec, extra })
            }
          >
            导出渲染图 PNG<span className="psub">白底 1400×1050</span>
          </button>
          <div className="subrow">
            <button
              onClick={() =>
                exportDepthPNG(rigRef.current, {
                  target: targetVec,
                  ground: groundRef.current,
                  extra,
                })
              }
            >
              深度图 PNG
            </button>
            <button
              onClick={() =>
                exportCameraJSON(rigRef.current, { target: targetVec, extra, transparent })
              }
            >
              机位参数 JSON
            </button>
          </div>
          <div className="airow">
            <div className="aihead">
              <button
                onClick={() =>
                  exportAIBundle(rigRef.current, {
                    ground: groundRef.current,
                    target: targetVec,
                    extra,
                    transparent,
                  })
                }
              >
                AI 交接包 · 干净版
              </button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                透明底
              </label>
            </div>
            <p
              className="hint"
              title="1 个 ZIP 包含：干净渲染图（无地面/阴影；勾选「透明底」则产品外 alpha=0）、深度图、机位 JSON。深度图为控制网络专用（ControlNet / Qwen-Image-Edit 等），普通文生图/图生图只用干净图 + 文字提示词。"
            >
              1 个 ZIP（干净图 + 深度图 + JSON）· 透明底可选 · 深度图仅支持 ControlNet/Qwen
            </p>
          </div>
        </footer>
      </aside>

      <main className="stage" ref={stageRef} onPointerDown={() => setShowHint(false)}>
        <div
          className="frame"
          role="group"
          aria-label="3D 预览画布"
          style={frame.w > 1 ? { width: `${frame.w}px`, height: `${frame.h}px` } : undefined}
        >
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
          {frame.w > 1 && (
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

              {/* fallback 设为 null：加载卡改由 frame 内的 DOM 浮层承担，
                  避免 drei <Html> 在网格 Suspense 里的挂载/卸载触发 React removeChild 报错 */}
              <Suspense fallback={null}>
                <CanvasErrorBoundary key={mode} onError={(e) => setCanvasError(e)}>
                  <group ref={subjectRef}>
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
                  </group>
                </CanvasErrorBoundary>
                <SceneReady onReady={() => setSceneReady(true)} />
              </Suspense>

              {/* 影棚地面：一张光池圆盘 + 一层只接阴影的透明面（柔和接触阴影，无网格无灰带）。
                  包进 group 以便干净版/AI 包导出时整体隐藏；圆盘单独挂 discRef，
                  白底渲染图导出时只隐藏圆盘、保留接地阴影面。 */}
              <group ref={groundRef}>
                <mesh ref={discRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                  <circleGeometry args={[4.8, 48]} />
                  <meshStandardMaterial color="#2b3038" roughness={1} />
                </mesh>
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
                  <planeGeometry args={[40, 40]} />
                  <shadowMaterial opacity={0.34} />
                </mesh>
              </group>

              <RigRegistrar rigRef={rigRef} />
              <CameraRig camCmd={camCmd} target={camCmd.target} controlsRef={controlsRef} rigRef={rigRef} />
              <OrbitControls
                ref={controlsRef}
                makeDefault
                target={camCmd.target}
                enableDamping
                dampingFactor={0.08}
                rotateSpeed={0.45}
                zoomSpeed={0.75}
                minDistance={3.5}
                maxDistance={40}
                minPolarAngle={deg2rad(30)} // 俯角上限 60°
                maxPolarAngle={deg2rad(85)} // 俯角下限 5°
                minAzimuthAngle={deg2rad(-65)}
                maxAzimuthAngle={deg2rad(65)}
                onStart={() => {
                  rigRef.current?.cancelAnim?.()
                  setPresetName('custom') // 用户拖拽后不再属于任何预设
                }}
              />
            </Canvas>
          )}
          {/* 加载浮层：frame 内、Canvas 外的普通 DOM，首帧场景就绪前显示 */}
          {!sceneReady && (
            <div className="loadcard overlay"><i className="spin" />正在加载产品贴图…</div>
          )}
        </div>
      </main>
    </div>
  )
}
