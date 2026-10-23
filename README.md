# 3D 虚拟摄影棚（studio3d）

电商产品图的 3D 虚拟摄影棚前端：用真实产品贴图 + 参数化代理模型在浏览器里摆产品、调机位，一键导出「渲染图 / 深度图 / 机位参数」给后续 AI 生图管线使用。

**在线演示**：https://love8868.github.io/studio3d-prototype/

技术栈：React 19 + Vite 7 + three.js 0.180 + @react-three/fiber 9 + @react-three/drei 10（R3F v9 必须配 React 19）。

## 快速开始

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm run build      # 生产构建到 dist/
# 部署到子路径（如 GitHub Pages 项目页）时：
npx vite build --base=./
```

直达参数：`?mode=cabinet|cable|mount`，线缆预设 `&cable=coil|flatspiral|figure8|bundle|serpentine|drape|catenary|straight`。

## 功能（v0.4）

### 三种演示对象（均为数据生成，无手工模型）
- **充电柜（贴图盒子）**：长宽高参数盒体 + 官网实拍贴图（前/侧/背，顶底纯色；贴图面用不吃光材质避免双重光影）。正面定义了 10 个 USB 端口锚点，可接线：选口插线、线缆垂落到地面。
- **线缆（管线代理）**：曲线公式生成点列 → CatmullRom → TubeGeometry 扫管。8 种形态预设（盘绕/平盘螺旋/8 字/束线环/S 形/垂落/悬链垂坠/直连，悬链为真实 catenary 公式）；**长度、垂坠滑杆**实时重算；**线型档案**四种（USB-C/网线 RJ45/HDMI/电源线，各有线径、接头拼装模型、颜色、硬度→垂坠系数）。
- **支架（基本体代理）**：底座/立杆/臂/VESA 面板参数拼装，臂摆角与俯仰滑杆；带半透明 **ghost 显示屏**（27″/43″/55″ 三档）呈现安装状态；**安装姿态**三态（桌面式/壁挂式（带 ghost 墙）/臂展式）。

### 机位与镜头
- 机位预设（正视/3/4 侧视/俯视）+ 等效焦段 35/50/85mm（按全画幅 24mm 传感器高换算 fov，换焦同步变距保构图）；也可自由拖动（方位 ±65°、仰角 5°–60°）。
- **包围盒自动取景（fit-to-object）**：按当前对象主体的 `Box3` + 当前画幅/焦段反解相机距离，四边约 9% 余量；切换对象、线缆形态、支架姿态、机位预设或焦段都会自动 refit。`适配画面` 按钮按**当前实际视角**（拖动后的方位/俯仰）重新取景。
- 注意：`俯视` 是 57° 高角度，不是 90° 正顶视；OrbitControls 上限为 60°。

### 导出（给 AI 管线的三件套）
导出画幅可选（footer「导出画幅」）：**预览取景框、成品图、深度图、AI 交接包共用同一画幅与 aspect**，避免预览与导出取景不一致。默认 4:3（1400×1050）。

| 画幅 | 像素 |
| --- | --- |
| 4:3 | 1400×1050 |
| 1:1 | 2000×2000 |
| 4:5 | 1600×2000 |
| 3:4 | 1500×2000 |
| 2:3 | 1600×2400 |
| 3:2 | 1800×1200 |
| 16:9 | 1920×1080 |
| 9:16 | 1080×1920 |

切换画幅会按当前方位/俯仰/焦段自动 refit；导出文件名在 `_<focal>mm` 后带画幅标识（如 `..._50mm_1x1_2026...png`）。
- **渲染图** PNG：白底所选画幅；导出时隐藏深色光池圆盘，只保留 ShadowMaterial 接触阴影（不再出现白底黑盘）。
- **深度图** PNG：单一代码路径（独立按钮与 AI 交接包共用）。临时收紧 near/far（按当前距离换算，不写死）、强制所选画幅、隐藏地面与 ghost 辅助体；`MeshDepthMaterial + RGBADepthPacking` → RenderTarget 读回 → 线性视深 → **8-bit 逆线性视差**（近白、远黑、背景纯黑），不是截图反相。
- **机位参数** JSON：`schema: studio3d/camera@1`，含画幅（`image_width/image_height/aspect_ratio`、`export.format_key/format_label`）、垂直 fov、传感器高、near/far、相机 up、方位/仰角约定、相机坐标与 target、导出模式/预设/透明底、深度 near/far 等；支持**导入 JSON 恢复机位**（文件或粘贴）——会一并恢复导出画幅（旧版无 schema 的 JSON 回退 4:3）。
- **AI 交接包·干净版**：打包成 **1 个 ZIP**（干净图 + 深度图 + 机位 JSON + README.txt），避免浏览器拦截多文件下载；勾选「透明底」时干净图带 alpha。干净图与深度图会隐藏 ground 与 ghost 墙/屏，只留产品本体；白底成品图仍保留 ghost 作展示参考。
- 深度图用途：Gemini / OpenAI 图像接口不接受 depth/pose 通道；深度图只适用于 Qwen-Image-Edit + ControlNet Union、fal `flux-general`、Runware 等支持 depth 条件的模型。

## 设计说明

- 对象一律以「安装好的使用状态」呈现：线缆接产品、支架带屏，不出裸配件。
- 代理模型只负责角度、比例、姿态（几何正确优先）；外观细节由实拍参考图 + AI 在后续管线补齐。
- 深色影棚视口（径向渐变 + 光池 + ShadowMaterial 接触阴影）仅供人眼判断落地与构图，导出渲染图强制白底。

## 目录

```
src/
  App.jsx               页面结构、状态、取景表、导出入口
  components/
    Objects.jsx         三种对象与线缆/接头/锚点/ghost 屏的生成器
    CameraRig.jsx       相机预设动画与机位反推
  lib/
    camera.js           机位参数换算
    formats.js          导出画幅表与尺寸校验（8 个常用规格）
    framing.js          主体包围盒自动取景（fitDistance / measureSubject）
    exporter.js         渲染/深度/JSON/干净版交接包导出（含 ZIP）
  styles.css
public/textures/        充电柜贴图（官网实拍裁切）
```

## 已知限制

- 导出画幅固定为表内 8 个规格（4:3 / 1:1 / 4:5 / 3:4 / 2:3 / 3:2 / 16:9 / 9:16），自定义像素尺寸未做。
- 一次只能导出当前机位；多角度 / 多画幅批量导出未做。
- 机位不写入 URL（仅 `?mode=&cable=` 支持直达），分享精确机位请用导出的 JSON。
- 面板上的方位/俯仰/距离为只读指标，直接在画面拖动或点预设调整。
- 充电柜正面贴图沿用官网实拍裁切，左上角 logo 在极限视角下可能贴边；后续可加 UV 内缩。

## License

MIT
