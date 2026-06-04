# Fastify + TypeScript Backend Template for Render

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Server:

```txt
http://localhost:5000
```

## Build

```bash
npm run build
npm start
```

## Render settings

Build Command:

```bash
npm install && npm run build
```

Start Command:

```bash
npm start
```

## Main endpoints

```txt
GET  /api/health
POST /api/auth/login
GET  /api/users/me
GET  /api/firebase/realtime-database-test
```

## Notes

- Put secrets only in Render Environment Variables.
- Do not expose Firebase service account in frontend.
- The Firebase test route returns the full Realtime Database root. Protect or remove it before production use.
- Any variable starting with NEXT_PUBLIC_ is public in Next.js.
