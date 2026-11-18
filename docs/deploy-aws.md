# Deploy on AWS (ECS Fargate)

One container image runs three things: the **web app**, the **worker** and the **database migration**. This guide uses managed
AWS services for everything stateful.

```
                       Route 53 ──> ALB (HTTPS, ACM certificate)
                                       │ :4002
        ┌──────────────────────────────┴───────────────┐
        │ ECS Fargate service "web"  (2+ tasks)        │
        │ ECS Fargate service "worker" (1 task)        │──> RDS PostgreSQL 16 + pgvector
        │ one-off task "migrate" (each release)        │──> ElastiCache Redis
        └──────────────────────────────────────────────┘──> S3 (resumes, private)
             logs: CloudWatch     secrets: Secrets Manager     mail: SES (SMTP)
```

> The `Dockerfile` in this repo is reviewed but was **not built** in the environment this guide was written in (no Docker
> daemon). Build it once locally (`docker build .`) before relying on it.

## 0. Variables used below

```bash
export AWS_REGION=ap-south-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export NAME=hirecraft
export DOMAIN=careers.example.com          # the public URL of the app
```

You need the AWS CLI v2, Docker, and permissions to create the resources below. Use an existing VPC with at least two
subnets in different Availability Zones (private subnets with a NAT gateway, or public subnets with public IPs on tasks).

## 1. Security groups

| Group            | Inbound                            |
| ---------------- | ---------------------------------- |
| `hirecraft-alb`  | 80 and 443 from `0.0.0.0/0`        |
| `hirecraft-app`  | 4002 from `hirecraft-alb`          |
| `hirecraft-data` | 5432 and 6379 from `hirecraft-app` |

```bash
export VPC_ID=vpc-xxxxxxxx
ALB_SG=$(aws ec2 create-security-group --group-name $NAME-alb --description alb --vpc-id $VPC_ID --query GroupId --output text)
APP_SG=$(aws ec2 create-security-group --group-name $NAME-app --description app --vpc-id $VPC_ID --query GroupId --output text)
DATA_SG=$(aws ec2 create-security-group --group-name $NAME-data --description data --vpc-id $VPC_ID --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $ALB_SG --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $APP_SG --protocol tcp --port 4002 --source-group $ALB_SG
aws ec2 authorize-security-group-ingress --group-id $DATA_SG --protocol tcp --port 5432 --source-group $APP_SG
aws ec2 authorize-security-group-ingress --group-id $DATA_SG --protocol tcp --port 6379 --source-group $APP_SG
```

## 2. Database: RDS PostgreSQL with pgvector

```bash
aws rds create-db-subnet-group --db-subnet-group-name $NAME --db-subnet-group-description $NAME \
  --subnet-ids subnet-aaaa subnet-bbbb
aws rds create-db-instance --db-instance-identifier $NAME --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.small --allocated-storage 50 --storage-encrypted \
  --master-username hirecraft --manage-master-user-password \
  --db-name hirecraft --db-subnet-group-name $NAME --vpc-security-group-ids $DATA_SG \
  --no-publicly-accessible --backup-retention-period 7 --deletion-protection
```

`--manage-master-user-password` keeps the password in Secrets Manager. When the instance is available, enable the extension
once (from a temporary bastion or Session Manager host inside the VPC, or as the first migration task):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

The connection string is `postgresql://hirecraft:<password>@<endpoint>:5432/hirecraft?sslmode=require`. Store it as the secret
`hirecraft/DATABASE_URL` (step 6). RDS Proxy is worth adding once you run many tasks.

## 3. Redis: ElastiCache (BullMQ queue and shared rate limit)

1. Create a **parameter group** (family `redis7`) with `maxmemory-policy = noeviction` (BullMQ requires it).
2. Create a replication group with the parameter group, `hirecraft-data` as the security group, encryption in transit on.

```bash
aws elasticache create-replication-group --replication-group-id $NAME --replication-group-description $NAME \
  --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 1 \
  --cache-parameter-group-name hirecraft-redis7 --security-group-ids $DATA_SG \
  --transit-encryption-enabled --at-rest-encryption-enabled
```

`REDIS_URL=rediss://<primary-endpoint>:6379` (note `rediss`, with TLS). Setting `REDIS_URL` means the web app queues jobs, so
the **worker service in step 9 must be running**.

## 4. Storage: S3 for resumes

```bash
aws s3api create-bucket --bucket $NAME-resumes-$ACCOUNT_ID --region $AWS_REGION \
  --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-public-access-block --bucket $NAME-resumes-$ACCOUNT_ID --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $NAME-resumes-$ACCOUNT_ID --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-versioning --bucket $NAME-resumes-$ACCOUNT_ID --versioning-configuration Status=Enabled
```

The app reaches S3 through the **ECS task role** (no keys): leave `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` unset. Set
`S3_BUCKET`, `S3_REGION` and `S3_FORCE_PATH_STYLE=false`.

## 5. Email: SES

1. SES → verify your domain (DKIM) and request production access (leave the sandbox).
2. Create SMTP credentials. Then `SMTP_HOST=email-smtp.$AWS_REGION.amazonaws.com`, `SMTP_PORT=587`, `SMTP_USER`,
   `SMTP_PASSWORD`, `SMTP_FROM=no-reply@example.com`.

## 6. Secrets and configuration

Put secrets in **Secrets Manager** (referenced from the task definition) and non-secrets as plain environment variables.

| Secret (Secrets Manager)                                                                                                                                                                                                                                            | Plain environment                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `NEXTAUTH_SECRET`, `AI_KEYS_ENCRYPTION_SECRET`, `CRON_SECRET`, `REDIS_URL` (if it has an auth token), `SMTP_PASSWORD`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VAPID_PRIVATE_KEY` | `NEXTAUTH_URL`, `APP_URL` (`https://$DOMAIN`), `AUTH_PROVIDERS`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE=false`, `REDIS_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `PLATFORM_ADMIN_EMAILS`, `FEATURE_TEAM_WEBHOOK=false`, `NODE_ENV=production` |

```bash
aws secretsmanager create-secret --name $NAME/NEXTAUTH_SECRET --secret-string "$(openssl rand -base64 32)"
aws secretsmanager create-secret --name $NAME/AI_KEYS_ENCRYPTION_SECRET --secret-string "$(openssl rand -base64 32)"
aws secretsmanager create-secret --name $NAME/CRON_SECRET --secret-string "$(openssl rand -hex 32)"
aws secretsmanager create-secret --name $NAME/DATABASE_URL --secret-string 'postgresql://...'
```

`AI_KEYS_ENCRYPTION_SECRET` must never change once portals have saved their own AI keys.

## 7. Build and push the image

`APP_URL` and friends are inlined into the edge middleware **at build time**, so pass them as build arguments.

```bash
aws ecr create-repository --repository-name $NAME
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build \
  --build-arg APP_URL=https://$DOMAIN --build-arg NEXTAUTH_URL=https://$DOMAIN \
  --build-arg PUBLIC_PORTAL_BASE_DOMAIN=example.com --build-arg PORTAL_CNAME_TARGET=portals.example.com \
  -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$NAME:$(git rev-parse --short HEAD) .
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$NAME:$(git rev-parse --short HEAD)
```

## 8. ECS: cluster, roles, task definitions

```bash
aws ecs create-cluster --cluster-name $NAME
aws logs create-log-group --log-group-name /ecs/$NAME
```

**Roles**

- `hirecraft-execution` : the managed `AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:*:*:secret:hirecraft/*`.
- `hirecraft-task` : an inline policy allowing `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::hirecraft-resumes-<account>/*` and `s3:ListBucket` on the bucket.

**Task definition (web)**: save as `web.json`, then `aws ecs register-task-definition --cli-input-json file://web.json`.

```json
{
  "family": "hirecraft-web",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/hirecraft-execution",
  "taskRoleArn": "arn:aws:iam::<ACCOUNT_ID>:role/hirecraft-task",
  "containerDefinitions": [
    {
      "name": "web",
      "image": "<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/hirecraft:<TAG>",
      "essential": true,
      "portMappings": [{ "containerPort": 4002 }],
      "command": ["npm", "run", "start"],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "APP_URL", "value": "https://careers.example.com" },
        { "name": "NEXTAUTH_URL", "value": "https://careers.example.com" },
        { "name": "AUTH_PROVIDERS", "value": "credentials,email" },
        { "name": "S3_BUCKET", "value": "hirecraft-resumes-<ACCOUNT_ID>" },
        { "name": "S3_REGION", "value": "<REGION>" },
        { "name": "S3_FORCE_PATH_STYLE", "value": "false" },
        { "name": "REDIS_URL", "value": "rediss://<primary-endpoint>:6379" },
        { "name": "SMTP_HOST", "value": "email-smtp.<REGION>.amazonaws.com" },
        { "name": "SMTP_PORT", "value": "587" },
        { "name": "SMTP_FROM", "value": "no-reply@example.com" },
        { "name": "PLATFORM_ADMIN_EMAILS", "value": "you@example.com" },
        { "name": "FEATURE_TEAM_WEBHOOK", "value": "false" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:hirecraft/DATABASE_URL"
        },
        {
          "name": "NEXTAUTH_SECRET",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:hirecraft/NEXTAUTH_SECRET"
        },
        {
          "name": "AI_KEYS_ENCRYPTION_SECRET",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:hirecraft/AI_KEYS_ENCRYPTION_SECRET"
        },
        {
          "name": "CRON_SECRET",
          "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:hirecraft/CRON_SECRET"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/hirecraft",
          "awslogs-region": "<REGION>",
          "awslogs-stream-prefix": "web"
        }
      }
    }
  ]
}
```

Create `hirecraft-worker` the same way with `"command": ["npm", "run", "worker"]`, no `portMappings`, stream prefix `worker`.
Add the other secrets from step 6 (`SMTP_PASSWORD`, AI keys, Stripe, VAPID private key) to **both** definitions.

## 9. Load balancer, HTTPS and the services

1. **ACM certificate** for `$DOMAIN` (DNS validation).
2. **ALB** in the public subnets with `hirecraft-alb`; a **target group** (type `ip`, port 4002, health check path `/api/health`);
   an HTTPS :443 listener with the certificate forwarding to the target group, and :80 redirecting to :443.
3. **Route 53**: an alias A record `$DOMAIN` → the ALB.
4. **Services**:

```bash
aws ecs create-service --cluster $NAME --service-name web --task-definition hirecraft-web --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaaa,subnet-bbbb],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<TG_ARN>,containerName=web,containerPort=4002" \
  --health-check-grace-period-seconds 90 \
  --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"

aws ecs create-service --cluster $NAME --service-name worker --task-definition hirecraft-worker --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaaa,subnet-bbbb],securityGroups=[$APP_SG],assignPublicIp=DISABLED}"
```

Use `assignPublicIp=ENABLED` if your subnets are public and you have no NAT. Tasks in private subnets need a NAT gateway (or VPC
endpoints for ECR, S3, Secrets Manager, CloudWatch Logs) to pull the image and reach the AI provider and SES.

Run **exactly one worker** unless you also want parallel job processing (`WORKER_CONCURRENCY` controls parallelism per task); the
time-based tick is idempotent, so a second worker is safe.

## 10. Migrations on every release

Run before updating the web service, using the web task definition with a command override:

```bash
aws ecs run-task --cluster $NAME --launch-type FARGATE --task-definition hirecraft-web \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaaa],securityGroups=[$APP_SG],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"web","command":["npx","prisma","migrate","deploy"]}]}'
```

The first run also creates the schema (and the `vector` extension if the database role may create it, otherwise create it by hand
as in step 2). Wait for the task to stop with exit code 0 (`aws ecs describe-tasks`).

## 11. Release automation (GitHub Actions sketch)

```yaml
name: deploy
on: { push: { branches: [main] } }
permissions: { id-token: write, contents: read }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          {
            role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/github-deploy,
            aws-region: ap-south-1,
          }
      - uses: aws-actions/amazon-ecr-login@v2
        id: ecr
      - run: |
          IMAGE=${{ steps.ecr.outputs.registry }}/hirecraft:${{ github.sha }}
          docker build --build-arg APP_URL=https://careers.example.com --build-arg NEXTAUTH_URL=https://careers.example.com -t $IMAGE .
          docker push $IMAGE
      # then: register new task definition revisions with $IMAGE, run the migrate task, wait for it, update both services
```

## 12. Customer custom domains (Enterprise, optional)

Verified customer hostnames must reach the app **with a valid certificate**. On AWS pick one:

- **Caddy with on-demand TLS** (recommended): run Caddy (an ECS service behind an NLB, with persistent storage for certs, or a
  small EC2 instance) in front of the ALB. Customers CNAME their host to the NLB name (`PORTAL_CNAME_TARGET=portals.example.com`).

  ```
  {
    on_demand_tls { ask https://careers.example.com/api/public/domains/resolve }
  }
  https:// {
    tls { on_demand }
    reverse_proxy https://<alb-dns-name> { header_up Host {host} }
  }
  ```

  The `ask` endpoint answers 200 only for hostnames a portal has verified, so certificates are never issued for random names.

- **ACM certificates per customer on the ALB**: automate `acm request-certificate` + `elbv2 add-listener-certificates` when a domain
  is verified (default quota is 25 certificates per listener).

The app routes by the `Host` header, so the proxy must forward the original host. Sign-in and apply pages redirect to
`APP_URL`.

## 13. Operations

| Topic       | Practice                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs        | CloudWatch group `/ecs/hirecraft`; alarm on 5xx from the ALB and on task restarts                                                              |
| Scaling     | ECS service auto scaling on CPU 60 % (min 2, max 6 web tasks); worker stays at 1                                                               |
| Backups     | RDS automated backups (7+ days) and a manual snapshot before risky migrations; S3 versioning is on                                             |
| Health      | ALB health check `/api/health`; the container also has a `HEALTHCHECK`                                                                         |
| Cost levers | `db.t4g.small`, `cache.t4g.micro`, 1 vCPU / 2 GB Fargate tasks are enough to start; add RDS Proxy and a NAT gateway only when needed           |
| Rollback    | Re-deploy the previous task definition revision. Migrations are forward-only, so ship backwards-compatible schema changes                      |
| Security    | Private subnets for tasks, RDS and Redis; no public S3; secrets only in Secrets Manager; rotate `NEXTAUTH_SECRET` only with a planned re-login |

## 14. Post-deploy checklist

- [ ] `https://$DOMAIN/api/health` returns 200 through the ALB
- [ ] Sign up, create a portal, publish a job, apply as a candidate
- [ ] Upload a resume (S3 through the task role) and see it parsed (worker consuming the queue: check the worker logs)
- [ ] Invite a teammate (SES)
- [ ] `/admin` opens for `PLATFORM_ADMIN_EMAILS`
- [ ] Stripe webhook `https://$DOMAIN/api/webhooks/stripe` delivers (if billing is on)
