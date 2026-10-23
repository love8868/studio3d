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
- 机位预设（正视/3/4 侧视/俯视）+ 等效焦段 35/50/85mm（按全画幅 24mm 传感器高换算 fov，换焦同步变距保构图）；也可自由拖动（方位 ±65°、俯角 5°–60°）。
- 每个对象（及线缆形态、支架姿态）有独立取景表，切换自动居中取景。

### 导出（给 AI 管线的三件套）
- **带棚渲染图** PNG（白底 1400×1050，含地面与接触阴影，预览/直用）
- **深度图** PNG（真深度管线：MeshDepthMaterial + RGBADepthPacking 渲染到 RenderTarget 后解包反相，非截图冒充）
- **机位参数** JSON（方位角/俯仰角/等效焦段/距离/相机坐标，由真实相机位置反推）
- **AI 交接包·干净版**：一键三件，导出帧临时隐藏地面与阴影——干净渲染图（白底纯产品）+ 干净深度图（纯产品几何）+ 机位参数，阴影留给 AI 按最终场景光影生成。

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
    exporter.js         渲染/深度/JSON/干净版交接包导出
  styles.css
public/textures/        充电柜贴图（官网实拍裁切）
```

## License

MIT
