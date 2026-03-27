import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
// @ts-ignore - 我们直接引用 Babel 核心插件
import debugInspectorBabel from '@linhey/react-debug-inspector'

export default defineConfig({
  plugins: [
    react({
      // 使用 SWC 版插件并保留源码注入
    }),
    {
      name: 'manual-debug-inspector',
      apply: 'serve',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.includes('src/') || !/\.[jt]sx$/.test(id)) return null
        
        // 我们利用这个库的 Babel 转换逻辑
        const { transformAsync } = await import('@babel/core')
        const result = await transformAsync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          plugins: [debugInspectorBabel],
          parserOpts: { plugins: ['jsx', 'typescript'] },
        })
        
        return result?.code ? { code: result.code, map: result.map } : null
      }
    }
  ],
  server: {
    port: 5188,
    host: '127.0.0.1',
    proxy: {
      '/__neptune_gateway': {
        target: 'http://127.0.0.1:18765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__neptune_gateway/, ''),
      },
    },
  }
})
