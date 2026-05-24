import { readFileSync } from 'node:fs';
import { validateInfra } from '../infra/infra-parser';

export function runValidateInfra(path: string, maxComponents: number = 20): number {
  try {
    const md = readFileSync(path, 'utf8');
    const r = validateInfra(md, { maxComponents });
    console.log(`OK: ${r.components.length} components`);
    for (const w of r.warnings) console.warn(`WARN: ${w}`);
    return 0;
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    return 1;
  }
}

if (process.argv[2]) {
  process.exit(runValidateInfra(process.argv[2], Number(process.env.MAX_COMPONENTS ?? 20)));
}
