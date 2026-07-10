import { readFileSync, writeFileSync } from "node:fs";
import type { Database, Design, Frontend, Selections } from "./types.js";

function toDbName(slug: string): string {
    return slug.replace(/-/g, "_") + "_local";
}

function frontendLabel(frontend: Frontend): string {
    return frontend === "tanstack"
        ? "TanStack Router SPA (React 19 + Vite)"
        : "Next.js 15 App Router";
}

function databaseLabel(database: Database): string {
    return database === "mongo" ? "MongoDB" : "PostgreSQL (Kysely)";
}

function designLabel(design: Design): string {
    return design === "shadcn" ? "shadcn/ui" : "bespoke tokens";
}

function needsRedis(selections: Selections): boolean {
    return selections.workers || selections.cache || selections.rateLimit;
}

export function renderDockerCompose(selections: Selections): string {
    const { slug, database, frontend } = selections;
    const dbName = toDbName(slug);
    const withRedis = needsRedis(selections);

    const serverDbEnv =
        database === "mongo"
            ? [
                  `    MONGO_URL: mongodb://root:secret@${slug}-mongo:27017/?replicaSet=rs0&authSource=admin`,
                  `    MONGO_DATABASE: ${dbName}`,
              ].join("\n")
            : `    DATABASE_URL: postgres://postgres:secret@${slug}-postgres:5432/${dbName}`;

    const serverAnchor = [
        `x-server-config: &server-config`,
        `    PORT: 4000`,
        `    TEST_URL: http://localhost:4000`,
        `    FIREBASE_CLIENT_EMAIL: \${FIREBASE_CLIENT_EMAIL}`,
        `    FIREBASE_PRIVATE_KEY: \${FIREBASE_PRIVATE_KEY}`,
        `    FIREBASE_PROJECT_ID: \${FIREBASE_PROJECT_ID}`,
        `    FIREBASE_API_KEY: \${FIREBASE_API_KEY}`,
        ...(withRedis ? [`    REDIS_URL: redis://${slug}-redis:6379`] : []),
        serverDbEnv,
        `    JWT_SECRET: \${JWT_SECRET}`,
        `    SENDGRID_API_KEY: \${SENDGRID_API_KEY}`,
        `    SENDGRID_FROM_EMAIL: \${SENDGRID_FROM_EMAIL}`,
    ].join("\n");

    const webAnchorRef = frontend === "tanstack" ? "vite-config" : "web-config";
    const webAnchor =
        frontend === "tanstack"
            ? [
                  `x-vite-config: &vite-config`,
                  `    VITE_FIREBASE_API_KEY: \${FIREBASE_API_KEY}`,
                  `    VITE_FIREBASE_AUTH_DOMAIN: \${FIREBASE_AUTH_DOMAIN}`,
                  `    VITE_FIREBASE_PROJECT_ID: \${FIREBASE_PROJECT_ID}`,
                  `    VITE_FIREBASE_APP_ID: \${FIREBASE_APP_ID}`,
                  `    VITE_API_URL: http://localhost:4000`,
              ].join("\n")
            : [
                  `x-web-config: &web-config`,
                  `    NEXT_PUBLIC_API_URL: http://localhost:4000`,
              ].join("\n");

    const dbServiceName =
        database === "mongo" ? `${slug}-mongo` : `${slug}-postgres`;

    const dbService =
        database === "mongo"
            ? [
                  `    ${slug}-mongo:`,
                  `        build:`,
                  `            context: .`,
                  `            dockerfile: Dockerfile.mongo`,
                  `            args:`,
                  `                MONGO_VERSION: 7`,
                  `        container_name: ${slug}-mongo`,
                  `        ports:`,
                  `            - "27017:27017"`,
                  `        healthcheck:`,
                  `            test: mongosh --quiet --eval "try { rs.status().ok } catch(e) { 0 }"`,
                  `            interval: 5s`,
                  `            timeout: 5s`,
                  `            retries: 10`,
                  `            start_period: 10s`,
                  `        volumes:`,
                  `            - ./mongo/scripts:/scripts`,
                  `            - ./mongo/seeds:/seeds`,
                  `        working_dir: /scripts`,
                  `        environment:`,
                  `            MONGO_INITDB_ROOT_USERNAME: root`,
                  `            MONGO_INITDB_ROOT_PASSWORD: secret`,
                  `            MONGO_INITDB_DATABASE: ${dbName}`,
                  `            RS_HOST: ${slug}-mongo`,
              ].join("\n")
            : [
                  `    ${slug}-postgres:`,
                  `        image: postgres:16`,
                  `        container_name: ${slug}-postgres`,
                  `        ports:`,
                  `            - "5432:5432"`,
                  `        environment:`,
                  `            POSTGRES_USER: postgres`,
                  `            POSTGRES_PASSWORD: secret`,
                  `            POSTGRES_DB: ${dbName}`,
                  `        healthcheck:`,
                  `            test: ["CMD-SHELL", "pg_isready -U postgres -d ${dbName}"]`,
                  `            interval: 5s`,
                  `            timeout: 5s`,
                  `            retries: 10`,
                  `            start_period: 10s`,
                  `        volumes:`,
                  `            - ${slug}-postgres-data:/var/lib/postgresql/data`,
              ].join("\n");

    const redisService = [
        `    ${slug}-redis:`,
        `        image: redis:latest`,
        `        container_name: ${slug}-redis`,
    ].join("\n");

    const serverService = [
        `    ${slug}-server:`,
        `        build:`,
        `            context: .`,
        `            dockerfile: Dockerfile.server`,
        `            target: dev`,
        `        container_name: ${slug}-server`,
        `        ports:`,
        `            - "4000:4000"`,
        `        environment:`,
        `            <<:`,
        `                - *server-config`,
        `        volumes:`,
        `            - .dumps:/app/apps/server/.dumps`,
        `        depends_on:`,
        `            ${dbServiceName}:`,
        `                condition: service_healthy`,
        ...(withRedis
            ? [
                  `            ${slug}-redis:`,
                  `                condition: service_started`,
              ]
            : []),
        `        command: npm run start`,
        `        develop:`,
        `            watch:`,
        `                - action: rebuild`,
        `                  path: ./apps/shared/lib/package.json`,
        `                - action: sync`,
        `                  path: ./apps/shared/lib`,
        `                  target: /app/apps/shared/lib`,
        `                  ignore:`,
        `                      - ./apps/shared/lib/node_modules`,
        `                      - ./apps/shared/lib/dist`,
        `                - action: rebuild`,
        `                  path: ./apps/server/package.json`,
        `                - action: sync`,
        `                  path: ./apps/server`,
        `                  target: /app/apps/server`,
        `                  ignore:`,
        `                      - ./apps/server/node_modules`,
        `                      - ./apps/server/dist`,
        `                      - ./.dumps`,
    ].join("\n");

    const webVolumesLines =
        frontend === "tanstack"
            ? [
                  `        volumes:`,
                  `            - ./apps/web/__generated__:/app/apps/web/__generated__`,
              ]
            : [];

    const webIgnoreLines =
        frontend === "tanstack"
            ? [`                      - __generated__/`]
            : [
                  `                      - .next/`,
                  `                      - node_modules/`,
              ];

    const webService = [
        `    ${slug}-web:`,
        `        build:`,
        `            context: .`,
        `            dockerfile: Dockerfile.web`,
        `            target: dev`,
        `            args:`,
        `                <<: *${webAnchorRef}`,
        `        container_name: ${slug}-web`,
        `        ports:`,
        `            - "5173:5173"`,
        `        environment:`,
        `            <<: *${webAnchorRef}`,
        ...webVolumesLines,
        `        depends_on:`,
        `            - ${slug}-server`,
        `        command: npm run dev`,
        `        develop:`,
        `            watch:`,
        `                - action: sync`,
        `                  path: ./apps/web`,
        `                  target: /app/apps/web`,
        `                  ignore:`,
        ...webIgnoreLines,
        `                - action: sync`,
        `                  path: ./apps/shared/lib`,
        `                  target: /app/apps/shared/lib`,
        `                - action: rebuild`,
        `                  path: ./apps/web/package.json`,
    ].join("\n");

    const blocks = [
        serverAnchor,
        webAnchor,
        `services:`,
        dbService,
        ...(withRedis ? [redisService] : []),
        serverService,
        webService,
    ];

    if (database === "postgres") {
        blocks.push([`volumes:`, `    ${slug}-postgres-data:`].join("\n"));
    }

    return blocks.join("\n\n") + "\n";
}

export function renderEnvExample(selections: Selections): string {
    const { slug, database } = selections;
    const dbName = toDbName(slug);

    const dbBlock =
        database === "mongo"
            ? [
                  `# Mongo is provisioned by docker-compose; MONGO_URL / MONGO_DATABASE are wired`,
                  `# there (mongodb://root:<MONGO_PASSWORD>@${slug}-mongo:27017, database ${dbName}).`,
                  `MONGO_PASSWORD="secret"`,
              ]
            : [
                  `# Postgres is provisioned by docker-compose; DATABASE_URL is wired there`,
                  `# (postgres://postgres:<POSTGRES_PASSWORD>@${slug}-postgres:5432/${dbName}).`,
                  `POSTGRES_PASSWORD="secret"`,
              ];

    const redisBlock = needsRedis(selections)
        ? [
              `# Redis is provisioned by docker-compose; REDIS_URL is wired there`,
              `# (redis://${slug}-redis:6379).`,
              ``,
          ]
        : [];

    return [
        `# Auth JWT signing secret — required`,
        `JWT_SECRET="some_secret_key"`,
        ``,
        ...redisBlock,
        ...dbBlock,
        ``,
        `# Firebase auth — optional, leave blank to disable Firebase auth`,
        `FIREBASE_CLIENT_EMAIL=""`,
        `FIREBASE_PRIVATE_KEY=""`,
        `FIREBASE_PROJECT_ID=""`,
        `FIREBASE_APP_ID=""`,
        `FIREBASE_AUTH_DOMAIN=""`,
        `FIREBASE_API_KEY=""`,
        ``,
        `# SendGrid transactional email — optional, leave blank to disable email`,
        `SENDGRID_API_KEY=""`,
        `SENDGRID_FROM_EMAIL="no-reply@example.com"`,
        ``,
    ].join("\n");
}

export function injectStackBlock(
    readmePath: string,
    selections: Selections,
): void {
    const { frontend, database, design, cordova, workers, cache, rateLimit } =
        selections;

    const block = [
        ``,
        `## Stack`,
        ``,
        `- **Frontend**: ${frontendLabel(frontend)}`,
        `- **Backend**: Express API (shared)`,
        `- **Database**: ${databaseLabel(database)}`,
        `- **Design system**: ${designLabel(design)}`,
        `- **Workers**: ${workers ? "BullMQ (Redis-backed queues + workers process)" : "not enabled"}`,
        `- **Cache**: ${cache ? "Redis ($cache service)" : "not enabled"}`,
        `- **Rate limiting**: ${rateLimit ? "Redis-backed (auth routes)" : "not enabled"}`,
        `- **Mobile**: ${cordova ? "Cordova (Android/iOS)" : "not enabled"}`,
        ``,
    ].join("\n");

    const content = readFileSync(readmePath, "utf8");
    const lines = content.split("\n");
    const insertAt = lines.findIndex((line) => /^#\s+/.test(line));

    if (insertAt === -1) {
        writeFileSync(readmePath, block.trimStart() + "\n" + content);
        return;
    }

    lines.splice(insertAt + 1, 0, block);
    writeFileSync(readmePath, lines.join("\n"));
}
