# open-earth

策略战棋原型的地球实例，以 Three.js 重实现真实地球：学习地理与地缘政治。

- 渲染：Three.js + globe.gl（WebGL2），保持 Three.js 自身引擎轴
- 外壳：Tauri 2（桌面与 Android 共用前端），Vite 构建，Web 产物为纯静态文件
- 数据：Natural Earth 50m 国界底座，中国国界以阿里 DataV 数据按中国标准画法替换

## 开发

```bash
pnpm install
pnpm dev          # 仅前端，Vite 开发服务预览
pnpm tauri dev    # 桌面外壳
```
