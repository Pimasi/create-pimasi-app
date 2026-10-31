type Wire<E extends Record<string, string>> = `${E[keyof E]}`;

export function wireValues<
  E extends Record<string, string>,
  const T extends readonly Wire<E>[],
>(
  _enum: E,
  _values: T & ([Wire<E>] extends [T[number]] ? unknown : never),
): void {}

export enum Frontend {
  TANSTACK = "tanstack",
  NEXTJS = "nextjs",
}
wireValues(Frontend, ["tanstack", "nextjs"]);

export enum Database {
  MONGO = "mongo",
  POSTGRES = "postgres",
}
wireValues(Database, ["mongo", "postgres"]);

export enum Design {
  SHADCN = "shadcn",
  BESPOKE = "bespoke",
}
wireValues(Design, ["shadcn", "bespoke"]);

export enum Ci {
  GITHUB = "github",
  GITLAB = "gitlab",
  NONE = "none",
}
wireValues(Ci, ["github", "gitlab", "none"]);

export enum AddFeature {
  WORKERS = "workers",
  CACHE = "cache",
  RATE_LIMIT = "rate-limit",
  WEBSOCKETS = "websockets",
  CI_GITHUB = "ci-github",
  CI_GITLAB = "ci-gitlab",
}
wireValues(AddFeature, [
  "workers",
  "cache",
  "rate-limit",
  "websockets",
  "ci-github",
  "ci-gitlab",
]);

export enum Command {
  ENV = "env",
  ADD = "add",
  REMOVE = "remove",
  LIST = "list",
}
wireValues(Command, ["env", "add", "remove", "list"]);

export enum ReleaseBoolean {
  TRUE = "true",
  FALSE = "false",
}
wireValues(ReleaseBoolean, ["true", "false"]);

export type ServerAxis = Exclude<
  AddFeature,
  AddFeature.CI_GITHUB | AddFeature.CI_GITLAB
>;

export const SERVER_AXES = Object.values(AddFeature).filter(
  (feature): feature is ServerAxis =>
    feature !== AddFeature.CI_GITHUB && feature !== AddFeature.CI_GITLAB,
);

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

export enum ReservedEnvironment {
  PRODUCTION = "production",
}
wireValues(ReservedEnvironment, ["production"]);

export enum ReleaseBranch {
  MAIN = "main",
}
wireValues(ReleaseBranch, ["main"]);
