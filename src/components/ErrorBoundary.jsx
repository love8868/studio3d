import React from 'react'

// Canvas 内的错误边界：贴图加载失败等错误不再整页白屏，
// 而是回调 App 显示红色提示条（带错误信息，方便截图反馈）
export class CanvasErrorBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    this.props.onError?.(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
