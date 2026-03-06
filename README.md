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
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8080/api/projects`

## Дані

Кожен проєкт = папка у `./data/<projectId>/`:
- `source.pdf`
- `mappings/*.json`

При збереженні через UI mapping записується у стабільний формат:

```json
{ "schema": "pdf-mapper-web:v1", "fields": [ {"id":"...","name":"...","page":1,"x":72,"y":72,"w":100,"h":20} ] }
```

> MVP-нюанс: якщо ти завантажиш mapping у довільному старому форматі, фронтенд зробить best-effort normalize, а при Save збереже у форматі `v1`.

## API
- `GET /api/projects`
- `GET /api/project/{id}/pdf`
- `GET /api/project/{id}/mapping?name=runA`
- `PUT /api/project/{id}/mapping?name=runA`
- `POST /api/project/{id}/mapping/clone?from=runA&to=runA_fixed`
