type Wire<E extends Record<string, string>> = `${E[keyof E]}`;

export function wireValues<
    E extends Record<string, string>,
    const T extends readonly Wire<E>[],
>(
    _enum: E,
    _values: T & ([Wire<E>] extends [T[number]] ? unknown : never),
): void {}
