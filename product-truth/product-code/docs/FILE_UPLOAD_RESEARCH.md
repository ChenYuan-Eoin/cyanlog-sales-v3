# 文件上传方案调研

## 当前问题 (A8)
1. 两步流程：创建草稿 → 上传文件，失败需重试第一步
2. 无上传进度条
3. 无并发控制
4. 无拖拽上传反馈
5. 错误处理简陋

## 开源方案对比

### 1. react-dropzone (推荐)
- **优势**: 最流行、功能全面、TypeScript支持好
- **功能**: 拖拽、点击、多文件、文件类型验证、文件大小限制
- **体积**: ~8kb gzipped
- **维护**:  actively maintained

```bash
npm install react-dropzone
```

### 2. Uppy
- **优势**: 功能最强大，插件丰富
- **功能**: 拖拽、摄像头、云存储、断点续传、进度条
- **体积**: 较大 (~100kb+)
- **适用**: 需要复杂上传场景

```bash
npm install @uppy/core @uppy/react
```

### 3. react-use-upload
- **优势**: 轻量级 Hooks API
- **功能**: 进度跟踪、取消上传
- **体积**: 很小
- **适用**: 简单场景

### 4. 原生 XMLHttpRequest
- **优势**: 无依赖
- **功能**: 需要自行实现进度、拖拽等
- **适用**: 对体积极度敏感

## 推荐方案

**useUpload Hook (自建)** + **react-dropzone**

理由：
1. react-dropzone 提供完善的拖拽/点击上传交互
2. 自建 Hook 可以控制进度、并发、取消等逻辑
3. 与现有 Supabase Storage 集成
4. 代码可控，无过度依赖

## 实现计划

1. 创建 useUpload hook (参考 react-use-upload 设计)
2. 使用 react-dropzone 处理文件选择
3. 添加进度条组件
4. 集成到 ContractUploadPage
5. 添加并发控制 (max 3)
