import type { Extension, ExtensionRegistry, ExtensionType } from './types.js';

export class DefaultExtensionRegistry implements ExtensionRegistry {
  private extensions = new Map<string, Extension>();

  register(ext: Extension): void {
    if (this.extensions.has(ext.id)) {
      throw new Error(`Extension "${ext.id}" is already registered`);
    }
    this.extensions.set(ext.id, ext);
  }

  unregister(id: string): void {
    this.extensions.delete(id);
  }

  get(id: string): Extension | undefined {
    return this.extensions.get(id);
  }

  getAll(): Extension[] {
    return Array.from(this.extensions.values());
  }

  getByType(type: ExtensionType): Extension[] {
    return Array.from(this.extensions.values()).filter(ext => ext.type === type);
  }

  has(id: string): boolean {
    return this.extensions.has(id);
  }

  count(): number {
    return this.extensions.size;
  }

  countByType(): Record<ExtensionType, number> {
    const counts: Record<string, number> = {};
    for (const ext of this.extensions.values()) {
      counts[ext.type] = (counts[ext.type] ?? 0) + 1;
    }
    return counts as Record<ExtensionType, number>;
  }

  clear(): void {
    this.extensions.clear();
  }
}
