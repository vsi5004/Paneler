// Static-export stub. See client-stub.ts.

export type MigrationStatus =
  | { state: "pending" }
  | { state: "ready" }
  | { state: "error"; message: string };

export function startMigration(): Promise<void> {
  return Promise.resolve();
}

export function getMigrationStatus(): MigrationStatus {
  return { state: "ready" };
}
