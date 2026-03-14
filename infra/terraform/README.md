# Storytime AWS Infra (Terraform)

Diese Terraform-Stacks setzen die komplette Infrastruktur fuer die vorbereitete Service-Migration auf:

- VPC + private/public Subnets + NAT
- RDS PostgreSQL (verschluesselt, private)
- Secrets Manager Runtime-Secret (inkl. `DATABASE_URL`)
- EventBridge Activity Bus + Realtime Event Routing (Step 1)
- API Gateway HTTP API mit kompatiblen Route-Pfaden (inkl. Realtime Event Ingress)
- API Gateway WebSocket Skeleton fuer Activity-Streaming
- S3 Buckets (`content`, `assets`) + CloudFront Distribution
- KMS Key + CloudWatch Log Groups + Basis-Alarme
- Optionales GitHub OIDC Deploy Role

## 1) Voraussetzungen

- Terraform `>= 1.6`
- AWS Credentials in Shell (`aws configure` oder `AWS_PROFILE`)
- Berechtigungen fuer VPC, RDS, Lambda, API Gateway, CloudFront, S3, Secrets, EventBridge

## 2) Deployment

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Danach:

```bash
terraform output
```

Wichtige Outputs:

- `api_base_url`
- `websocket_api_url`
- `rds_endpoint`
- `runtime_secret_arn`
- `eventbridge_bus_name`
- `content_cdn_domain`
- `github_deploy_role_arn` (optional)

## 3) DB Schema in AWS initialisieren

Die Basis-Schemata fuer `conversations`, `conversation_messages`, `character_activities` und `character_relationships` liegen in:

- `sql/000_roles.sql`
- `sql/001_schema.sql`
- `sql/010_readiness_checks.sql`

Schema auf RDS anwenden (Beispiel):

```bash
psql "postgres://<user>:<password>@<rds-endpoint>:5432/storytime?sslmode=require" -f sql/001_schema.sql
psql "postgres://<user>:<password>@<rds-endpoint>:5432/storytime?sslmode=require" -f sql/000_roles.sql
psql "postgres://<user>:<password>@<rds-endpoint>:5432/storytime?sslmode=require" -f sql/010_readiness_checks.sql
```

## 4) Endpoint-Kompatibilitaet pruefen

```bash
API_BASE_URL=$(terraform output -raw api_base_url)
curl -sS "$API_BASE_URL/health"
curl -sS "$API_BASE_URL/ready"
curl -sS -X POST "$API_BASE_URL/api/activities" -H "content-type: application/json" -d '{}'
```

Erwartung:

- `health/ready` -> `200`
- migrierte Servicepfade aktuell -> `501 Service noch nicht migriert` (infra-ready Stub)

## 5) Naechste Migrationsphase

1. Read-Only-Domaenen sind bereits migriert (`game-objects`, `relationships`, `GET /api/activities`).
2. Realtime Schritt 1 ist event-driven: `POST /api/realtime/session`, `POST /api/realtime/instructions`, `POST /api/realtime/events`.
3. Conversations sind bewusst aus dem kritischen Realtime-Pfad entkoppelt und folgen als Projektion in Schritt 2 (`conversation-projection-step2.md`).
4. `GET /api/activities/stream` ist als SSE Snapshot-Bridge verfuegbar (kurzlebige Streams mit Auto-Reconnect); vollwertiges Push-Streaming folgt spaeter.
4. Content-Deploy erfolgt ueber `npm run content:deploy:aws` (inkl. versioniertem Snapshot in S3).

## IAM Blocker beheben

Falls `terraform apply` mit `AccessDenied` fehlschlaegt, nutze als Startpunkt:

- `required-iam-policy.json`

Danach erneut:

```bash
terraform plan -out=tfplan
terraform apply tfplan
```
