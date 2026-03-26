# oneyear-back

Node + Express backend for OneYear forum.

## Run

```bash
npm install
npm run dev
```

## Auto database connection

Server startup will automatically:

1. Connect MySQL with retry (up to 15 tries)
2. Connect Redis
3. Auto create required tables
4. Auto seed system circles: 世界 / 省 / 市 / 区

## Main APIs

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/circles`
- `POST /api/circles`
- `POST /api/circles/:id/invite`
- `POST /api/circles/join`
