/**
 * Allowlist management for sender and group IDs.
 * Supports exact matches and wildcard patterns (e.g., "user:*", "*").
 */
export class Allowlist {
  private entries: Set<string> = new Set();

  constructor(initialEntries?: string[]) {
    if (initialEntries) {
      for (const entry of initialEntries) {
        this.entries.add(entry);
      }
    }
  }

  /**
   * Add an ID or pattern to the allowlist.
   */
  addToAllowlist(id: string): void {
    this.entries.add(id);
  }

  /**
   * Remove an ID or pattern from the allowlist.
   */
  removeFromAllowlist(id: string): void {
    this.entries.delete(id);
  }

  /**
   * Check if a given ID is allowed by matching against all entries.
   * Supports wildcard patterns:
   *   - "*" matches everything
   *   - "prefix*" matches any ID starting with "prefix"
   *   - Exact match otherwise
   */
  isAllowed(id: string): boolean {
    if (this.entries.size === 0) {
      return false;
    }

    for (const pattern of this.entries) {
      if (pattern === '*') {
        return true;
      }
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (id.startsWith(prefix)) {
          return true;
        }
      } else if (id === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Static helper to check an ID against an external list of patterns.
   */
  static isAllowed(id: string, list: string[]): boolean {
    const allowlist = new Allowlist(list);
    return allowlist.isAllowed(id);
  }

  /**
   * Get all current allowlist entries.
   */
  getEntries(): string[] {
    return [...this.entries];
  }

  /**
   * Remove all entries from the allowlist.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get the number of entries in the allowlist.
   */
  get size(): number {
    return this.entries.size;
  }
}
