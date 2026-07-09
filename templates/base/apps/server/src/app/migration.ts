export interface Migration {
    /**
     * Unique migration name. Convention: `YYYYMMDDHHMMSS-{kebab-description}`
     * (`date +%Y%m%d%H%M%S`). The timestamp prefix sorts the registry
     * chronologically and guarantees uniqueness without coordination.
     */
    name: string;
    handler: () => Promise<void>;
}

const _proto = {};

export function Migration(migration: Migration): Migration {
    return Object.setPrototypeOf(migration, _proto);
}

Migration.isMigration = (val: any): val is Migration => {
    return Object.getPrototypeOf(val) === _proto;
};
