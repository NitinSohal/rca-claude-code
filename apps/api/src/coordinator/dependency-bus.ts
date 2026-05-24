import type { SubagentOutput } from '@rca/agent';

export class DependencyBus {
  private preliminary = new Map<string, Partial<SubagentOutput>>();

  publish(component: string, preliminary: Partial<SubagentOutput>): void {
    this.preliminary.set(component, preliminary);
  }

  lookup(component: string): Partial<SubagentOutput> | undefined {
    return this.preliminary.get(component);
  }

  reset(): void {
    this.preliminary.clear();
  }
}
