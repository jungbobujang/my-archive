import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 라이브러리를 따로 떼어 둔다. 앱 코드만 고쳐 배포해도
        // 서비스워커가 캐시해 둔 react/supabase 청크는 그대로 재사용된다.
        manualChunks: {
          react: ['react', 'react-dom'],
          supabase: ['@supabase/supabase-js']
        }
      }
    }
  },
  preview: {
    allowedHosts: true
  }
})
