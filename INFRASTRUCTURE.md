# Distributed Wagering Processor

## Infrastructure

NestJS runs on Bun, PostgreSQL is accessed through MikroORM, and LocalStack
provides local SQS. Docker Compose also runs database migrations before it starts
the API.

## Local setup

```powershell
bun install
Copy-Item .env.example .env
docker compose up -d postgres
docker compose up -d localstack
```

## Run the API

```powershell
bun run start:dev
```

`GET /health/live` checks only the process. `GET /health/ready` checks PostgreSQL
and both required SQS queues. `GET /health` remains a compatibility alias for
liveness.

## Migrations

```powershell
bun run migration:create -- --name=descriptive_name
bun run migration:up
bun run migration:down
bun run migration:pending
```

The development commands use `tsx` to load `mikro-orm.config.ts` and the source
configuration directly. New migrations and `.snapshot-wagering.json` are kept in
`src/database/migrations`; development does not depend on a previous build.

The production image instead runs already-compiled code:

```powershell
bun run build
bun run migration:up:prod
```

`migration:up:prod` does not build. It executes
`dist/database/run-migrations.js`, which loads migrations from
`dist/database/migrations`. Migrations are transactional and all-or-nothing.

## Containers

```powershell
docker compose up --build
```

On a fresh volume, Compose starts PostgreSQL and waits for its health check. The
one-shot `migrate` service then applies all migrations using the same image as the
API. The API starts only after migration exits successfully. LocalStack creates
the FIFO queue and DLQ in its ready hook, and its health check confirms both
queues exist before the API starts.

For an existing volume, use the same command. Only pending migrations run and
the volume is not reset:

```powershell
docker compose up --build -d
docker compose ps
docker compose logs migrate
```

To intentionally test a clean environment without touching the normal volume,
use another Compose project and alternate host ports:

```powershell
$env:API_PORT = "3001"
$env:POSTGRES_PORT = "5433"
$env:LOCALSTACK_PORT = "4567"
docker compose -p dwp-verification up --build -d
```

The project name prefixes its own PostgreSQL and LocalStack volumes. Do not run
`docker compose down -v` for the normal project unless its data is intentionally
being discarded.

Local development uses `SQS_ENDPOINT=http://localhost:4566`; containers use
`SQS_DOCKER_ENDPOINT=http://localstack:4566`. The separate values prevent a host
endpoint from accidentally resolving to the API container itself. Compose reads
its fake credentials from `LOCALSTACK_AWS_ACCESS_KEY_ID` and
`LOCALSTACK_AWS_SECRET_ACCESS_KEY`, avoiding accidental reuse of real AWS shell
credentials.
