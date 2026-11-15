/** Access-ordered cache with a fixed bound for per-person calculations. */
export class LruMap<K, V> extends Map<K, V> {
  private weight = 0;
  constructor(private readonly limit: number, private readonly weigh: (value: V) => number = () => 1, private readonly maxWeight = limit) { super(); }
  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key)!;
    super.delete(key);
    super.set(key, value);
    return value;
  }
  override set(key: K, value: V): this {
    this.delete(key);
    const weight = this.weigh(value);
    if (weight > this.maxWeight) return this;
    super.set(key, value);
    this.weight += weight;
    while (this.size > this.limit || this.weight > this.maxWeight) this.delete(this.keys().next().value!);
    return this;
  }
  override delete(key: K): boolean {
    if (!super.has(key)) return false;
    this.weight -= this.weigh(super.get(key)!);
    return super.delete(key);
  }
  override clear(): void {
    this.weight = 0;
    super.clear();
  }
}

/**
 * Memoises `compute` for the few objects it was most recently called with. Unlike a
 * WeakMap keyed by tree, this doesn't keep a result alive for every tree in the undo
 * history (each one a full copy of a per-person table); a tree that comes back after
 * an undo is simply worked out again.
 */
export function memoRecent<K extends object, V>(compute: (key: K) => V, size = 4): (key: K) => V {
  const keys: K[] = [];
  const values: V[] = [];
  return (key) => {
    // The same tree is asked for over and over, so it is checked first and stays first.
    if (keys[0] === key) return values[0];
    let i = keys.indexOf(key);
    let value: V;
    if (i >= 0) {
      value = values[i];
    } else {
      value = compute(key);
      i = keys.length === size ? size - 1 : keys.length;
    }
    keys.splice(i, 1);
    values.splice(i, 1);
    keys.unshift(key);
    values.unshift(value);
    return value;
  };
}

/**
 * A WeakMap-like cache that keeps entries for only the few keys used most recently. Caches
 * keyed by a tree's shape (lib/shape.ts) use it: every structure in the undo history keeps
 * its token alive, so with a WeakMap each one would keep its relationship tables too.
 */
export class RecentMap<K extends object, V> {
  private readonly keys: K[] = [];
  private readonly values: V[] = [];
  constructor(private readonly size = 4) {}
  get(key: K): V | undefined {
    if (this.keys[0] === key) return this.values[0];
    const i = this.keys.indexOf(key);
    if (i < 0) return undefined;
    const value = this.values[i];
    this.keys.splice(i, 1);
    this.values.splice(i, 1);
    this.keys.unshift(key);
    this.values.unshift(value);
    return value;
  }
  set(key: K, value: V): this {
    const i = this.keys.indexOf(key);
    if (i >= 0) {
      this.keys.splice(i, 1);
      this.values.splice(i, 1);
    }
    this.keys.unshift(key);
    this.values.unshift(value);
    if (this.keys.length > this.size) {
      this.keys.pop();
      this.values.pop();
    }
    return this;
  }
}
