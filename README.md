# PDF Mapper Web (Spring Boot + React)

Web-версія твого Swing viewer:
- PDF viewer (pdf.js)
- bbox overlay
- **drag-to-move** прямокутників
- редагування полів у панелі зліва
- Save / Save as (збереження mapping у JSON)

## Швидкий старт (docker-compose)

1) Поклади PDF у:

`./data/project1/source.pdf`

2) Запуск:

```bash
docker compose up --build
```

3) Відкрий:
- Frontend: `http://localhost:5172`
- Backend API: `http://localhost:5171/api/projects`

## Дані

Кожен проєкт = папка у `./data/<projectId>/`:
- `source.pdf`
- `mappings/*.json`

При збереженні через UI mapping записується у стабільний формат:

```json
{ "schema": "pdf-mapper-web:v1", "fields": [ {"id":"...","name":"...","page":1,"x":72,"y":72,"w":100,"h":20} ] }
```

> MVP-нюанс: якщо ти завантажиш mapping у довільному старому форматі, фронтенд зробить best-effort normalize, а при Save збереже у форматі `v1`.

## Production deploy (recommended)

Single container, one port (backend serves frontend):

```bash
docker compose -f docker-compose.prod.yml up -d
# → http://localhost:8080
```

See [docs/DEPLOY-BEST-PRACTICES.md](docs/DEPLOY-BEST-PRACTICES.md) for options (single-artifact vs separate frontend/backend).

## Deploy to AWS EC2 (free tier)

CI/CD via GitHub Actions: push to `main` deploys to EC2 (production image, port 8080). See [docs/DEPLOY-EC2.md](docs/DEPLOY-EC2.md) for instance setup and GitHub secrets.

## API
- `GET /api/projects`
- `GET /api/project/{id}/pdf`
- `GET /api/project/{id}/mapping?name=runA`
- `PUT /api/project/{id}/mapping?name=runA`
- `POST /api/project/{id}/mapping/clone?from=runA&to=runA_fixed`
