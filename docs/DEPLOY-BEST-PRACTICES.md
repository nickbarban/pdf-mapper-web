# Deployment best practices

## Recommended: single-artifact (backend serves frontend)

**Best for:** single server, free tier, small teams.

- Build the frontend once (`npm run build` → static files).
- Backend serves those files and the API from one process, one port (e.g. 8080).
- **Pros:** one URL, no CORS, one container/JAR to deploy and scale.
- **Cons:** frontend and backend ship together (usually acceptable).

**How to run:**

```bash
# From repo root
docker compose -f docker-compose.prod.yml up -d
```

One container, one port: **http://host:8080** (UI and API). Data is in `./data`.

---

## Alternative: frontend and backend separately

**Best for:** CDN for frontend, scaling backend independently, or serverless.

| Piece      | Where to deploy              | Notes |
|-----------|------------------------------|--------|
| Frontend  | Vercel, Netlify, S3+CloudFront, or nginx in Docker | Build `npm run build`, serve `dist/`. Set API base URL via env (e.g. `VITE_API_URL`). |
| Backend   | EC2, ECS, Elastic Beanstalk, or Lambda | Expose `/api` only. Set CORS to your frontend origin. |

**Pros:** scale and deploy independently; frontend on CDN.  
**Cons:** CORS and API URL config; two pipelines.

---

## Summary

- **Default choice:** use the **single-artifact** setup (backend serves frontend) and the production Docker Compose or JAR.
- Use **separate** frontend/backend only if you need a CDN, different scaling, or a serverless backend.
