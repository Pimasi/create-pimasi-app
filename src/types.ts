export type Frontend = "tanstack" | "nextjs";
export type Database = "mongo" | "postgres";
export type Design = "shadcn" | "bespoke";

export interface Selections {
  slug: string;
  frontend: Frontend;
  database: Database;
  design: Design;
  cordova: boolean;
  workers: boolean;
  cache: boolean;
  rateLimit: boolean;
  websockets: boolean;
}
