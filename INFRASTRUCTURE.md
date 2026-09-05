# Distributed Wagering Processor

## Infrastructure

NestJS runs on Bun, with PostgreSQL accessed through MikroORM. Docker Compose starts both the API and PostgreSQL.

## Local setup

```powershell
bun install
Copy-Item .env.example .env
docker compose up -d postgres
```

## Run the API

```powershell
bun run start:dev
```

`GET /health` returns `{ "status": "ok" }`.

## Migrations

```powershell
bun run migration:create -- --name=descriptive_name
bun run migration:up
bun run migration:down
bun run migration:pending
```

Migrations are transactional and all-or-nothing. The migration CLI and Nest application share `src/database/mikro-orm.config.ts`, so their database and entity-discovery settings cannot diverge.

## Containers

```powershell
docker compose up --build
```
