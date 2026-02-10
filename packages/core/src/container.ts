type Factory<T> = () => T;

interface Registration<T> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
}

export class Container {
  private registrations = new Map<string, Registration<unknown>>();

  register<T>(token: string, factory: Factory<T>): void {
    this.registrations.set(token, { factory, singleton: false });
  }

  registerSingleton<T>(token: string, factory: Factory<T>): void {
    this.registrations.set(token, { factory, singleton: true });
  }

  registerInstance<T>(token: string, instance: T): void {
    this.registrations.set(token, { factory: () => instance, singleton: true, instance });
  }

  resolve<T>(token: string): T {
    const reg = this.registrations.get(token);
    if (!reg) {
      throw new Error(`No registration found for token: ${token}`);
    }
    if (reg.singleton) {
      if (reg.instance === undefined) {
        reg.instance = reg.factory();
      }
      return reg.instance as T;
    }
    return reg.factory() as T;
  }

  has(token: string): boolean {
    return this.registrations.has(token);
  }

  async destroyAll(): Promise<void> {
    for (const [, reg] of this.registrations) {
      if (reg.instance && typeof (reg.instance as Record<string, unknown>).destroy === 'function') {
        await (reg.instance as { destroy(): Promise<void> }).destroy();
      }
    }
    this.registrations.clear();
  }
}
