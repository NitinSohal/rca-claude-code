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
