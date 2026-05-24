import { load as parseYaml } from 'js-yaml';
import { ComponentSchema, type Component } from '@rca/agent';

export interface ParsedComponent {
  name: string;
  yamlBlock: string;
}

export interface SplitInfra {
  prose: string;
  components: ParsedComponent[];
}

const HEADER_RE = /^## Component: (.+)$/gm;
const YAML_FENCE_RE = /```yaml\s*\n([\s\S]*?)\n```/m;

export function splitInfraMarkdown(md: string): SplitInfra {
  const matches = Array.from(md.matchAll(HEADER_RE));
  if (matches.length === 0) return { prose: md.trim(), components: [] };

  const firstStart = matches[0]!.index!;
  const prose = md.slice(0, firstStart).trim();

  const components: ParsedComponent[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i]!.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const section = md.slice(start, end);
    const name = matches[i]![1]!.trim();
    const yamlMatch = section.match(YAML_FENCE_RE);
    if (!yamlMatch) throw new Error(`Component "${name}" has no yaml block`);
    components.push({ name, yamlBlock: yamlMatch[1]! });
  }
  return { prose, components };
}

export interface ValidatedInfra {
  prose: string;
  components: Component[];
}

export function parseInfraMarkdown(md: string): ValidatedInfra {
  const { prose, components } = splitInfraMarkdown(md);
  const out: Component[] = [];
  for (const c of components) {
    let parsed: unknown;
    try {
      parsed = parseYaml(c.yamlBlock);
    } catch (err) {
      throw new Error(`Component "${c.name}": yaml parse error: ${(err as Error).message}`);
    }
    const result = ComponentSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Component "${c.name}": ${issues}`);
    }
    if (result.data.name !== c.name) {
      throw new Error(
        `Component header "${c.name}" does not match yaml name "${result.data.name}"`,
      );
    }
    out.push(result.data);
  }
  return { prose, components: out };
}

export interface ValidationOptions {
  maxComponents: number;
}

export interface ValidationResult extends ValidatedInfra {
  warnings: string[];
}

export function validateInfra(md: string, opts: ValidationOptions): ValidationResult {
  const { prose, components } = parseInfraMarkdown(md);

  if (components.length > opts.maxComponents) {
    throw new Error(`MAX_COMPONENTS exceeded: ${components.length} > ${opts.maxComponents}`);
  }

  const names = new Set(components.map((c) => c.name));
  for (const c of components) {
    for (const dep of c.depends_on ?? []) {
      if (!names.has(dep)) {
        throw new Error(`Component "${c.name}" depends_on unknown component "${dep}"`);
      }
    }
  }

  const cycles = findCycles(components);
  const warnings = cycles.map((c) => `cycle in depends_on: ${c.join(' → ')}`);

  return { prose, components, warnings };
}

function findCycles(components: Component[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const c of components) graph.set(c.name, c.depends_on ?? []);

  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  components.forEach((c) => color.set(c.name, WHITE));

  function dfs(node: string, stack: string[]): void {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (c === WHITE) {
        dfs(next, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const c of components) {
    if ((color.get(c.name) ?? WHITE) === WHITE) dfs(c.name, []);
  }
  return cycles;
}
