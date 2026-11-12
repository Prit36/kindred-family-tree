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
