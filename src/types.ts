export type Frontend = "tanstack" | "nextjs";
export type Database = "mongo" | "postgres";
export type Design = "shadcn" | "bespoke";
export type Ci = "github" | "gitlab" | "none";

export const SERVER_AXES = [
  "workers",
  "cache",
  "rate-limit",
  "websockets",
] as const;
export type ServerAxis = (typeof SERVER_AXES)[number];

export interface Selections {
  slug: string;
  frontend: Frontend;
  database: Database;
  design: Design;
  ci: Ci;
  cordova: boolean;
  workers: boolean;
  cache: boolean;
  rateLimit: boolean;
  websockets: boolean;
}

export interface Manifest {
  name: string;
  cliVersion: string;
  frontend: Frontend;
  database: Database;
  design: Design;
  ci?: Ci;
  cordova: boolean;
  workers: boolean;
  cache: boolean;
  rateLimit: boolean;
  websockets: boolean;
}
