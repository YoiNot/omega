export type Migrator = (data: any) => any;

/**
 * Sequential migration framework. Register a migrator keyed by the version it
 * upgrades FROM; `migrate` applies each step in order fromVersion -> toVersion.
 */
export class SaveMigrator {
  private readonly migrators = new Map<number, Migrator>();

  register(fromVersion: number, migrator: Migrator): this {
    this.migrators.set(fromVersion, migrator);
    return this;
  }

  migrate(data: any, fromVersion: number, toVersion: number): any {
    if (toVersion < fromVersion) {
      throw new Error(`Cannot migrate downwards: ${fromVersion} -> ${toVersion}`);
    }
    let current = data;
    for (let v = fromVersion; v < toVersion; v++) {
      const m = this.migrators.get(v);
      if (!m) throw new Error(`No migrator registered for version ${v}`);
      current = m(current);
    }
    return current;
  }
}
