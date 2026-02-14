import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
          headers: {
            'x-api-key': env.VITE_ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
          },
        },
      },
    },
  }
})
```

This fixes the build error. But the proxy still only works locally. For Vercel you need:

**Step 3 — Create a Vercel serverless function**

Create the folder and file `api/chat.ts` in your **project root** (not inside `src/`):
```
vite-react/
├── api/
│   └── chat.ts       ← create this
├── src/
├── .env
└── ...
