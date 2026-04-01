import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { createViteDebugInspectorPlugin } from '@linhey/react-debug-inspector'

export default defineConfig({
  plugins: [
    react({
      // 使用 SWC 版插件并保留源码注入
    }),
    createViteDebugInspectorPlugin()
  ],
  server: {
    port: 5188,
    host: '127.0.0.1',
  }
})
