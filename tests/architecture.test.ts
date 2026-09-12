import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(root, 'src');
const compositionRoot = path.join(sourceRoot, 'main.ts');
const frameOwner = path.join(sourceRoot, 'presentation/CityPresenter.ts');
type Layer = 'domain' | 'application' | 'infrastructure' | 'presentation';
const allowed: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  application: ['application', 'domain'],
  infrastructure: ['infrastructure', 'application', 'domain'],
  presentation: ['presentation', 'application'],
};
const browserGlobals = new Set(['window', 'document', 'localStorage', 'performance', 'requestAnimationFrame']);
const compilerOptions: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
};

function layerOf(filename: string): Layer | null {
  const first = path.relative(sourceRoot, filename).split(path.sep)[0];
  return first === 'domain' || first === 'application' || first === 'infrastructure' || first === 'presentation'
    ? first : null;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.[cm]?tsx?$/.test(filename) && !/\.test\.[cm]?tsx?$/.test(filename) ? [filename] : [];
  }).sort();
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function isNamedReference(node: ts.Node, name: string): boolean {
  return (ts.isIdentifier(node) && node.text === name)
    || ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && ts.isIdentifier(node.expression) && node.expression.text === 'globalThis' && memberName(node) === name);
}

/** Treat `Math` and `globalThis.Math` as the same reference to the value itself. */
function referenceRoot(node: ts.Node): ts.Node {
  const parent: ts.Node | undefined = node.parent;
  return parent && ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : node;
}

/**
 * True when the reference only serves as the object of a member access, as in
 * `Math.floor(x)`. Anything else — assignment, an argument, destructuring — hands the
 * value itself to the caller, which is how an alias escapes a member-level ban.
 */
function isMemberAccessTarget(node: ts.Node): boolean {
  const root = referenceRoot(node);
  const parent: ts.Node | undefined = root.parent;
  return Boolean(parent)
    && (ts.isPropertyAccessExpression(parent!) || ts.isElementAccessExpression(parent!))
    && parent!.expression === root;
}

/** Inspect syntax, including re-exports and dynamic/type imports; comments and copy are not code. */
function inspectSource(filename: string, text: string): string[] {
  if (/\.test\.[cm]?tsx?$/.test(filename)) return [];
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const from = layerOf(filename);
  const pureLayer = from === 'domain' || from === 'application';
  const violations: string[] = [];
  const report = (node: ts.Node, message: string): void => {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push(`${path.relative(root, filename)}:${position.line + 1}:${position.character + 1} ${message}`);
  };
  const inspectModule = (node: ts.Node): void => {
    // main.ts may assemble all layers; it is the only dependency exception.
    if (filename === compositionRoot) return;
    if (!ts.isStringLiteralLike(node)) {
      report(node, 'Nonliteral module specifiers cannot be checked.');
      return;
    }
    const specifier = node.text;
    if (specifier === 'three' || specifier.startsWith('three/')) {
      if (from !== 'presentation') report(node, `${from} cannot import ${specifier}`);
      return;
    }
    const resolved = ts.resolveModuleName(specifier, filename, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
    const target = resolved ?? (specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null);
    // Test modules are exempt from this scan, so production code reaching one could
    // launder a forbidden dependency through a re-export the scan never reads.
    // The extension is optional because an unresolvable specifier keeps its own spelling.
    if (target && /\.test(\.[cm]?tsx?)?$/.test(target)) {
      report(node, `${from} cannot import the unscanned test module ${specifier}`);
      return;
    }
    const to = target ? layerOf(target) : null;
    if (!from || !to || !allowed[from].includes(to)) {
      report(node, `${from} cannot import ${specifier} (${to ?? 'external/outside layers'})`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) inspectModule(node.moduleSpecifier);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) inspectModule(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression) inspectModule(node.moduleReference.expression);
    else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isNamedReference(node.expression, 'require'))
      && node.arguments[0]) inspectModule(node.arguments[0]);
    else if (ts.isImportTypeNode(node)) {
      inspectModule(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument);
    }

    const identifier = ts.isIdentifier(node) ? node.text : undefined;
    // Also cover globalThis['window'] and window['requestAnimationFrame'] aliases.
    const computedName = ts.isElementAccessExpression(node) ? memberName(node) : undefined;
    const reference = identifier ?? computedName;
    if (pureLayer && reference && browserGlobals.has(reference)) {
      report(node, `Forbidden browser reference: ${reference}`);
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) report(node, 'Explicit any is forbidden.');
    // Banning the binding itself, not just Date.now(), closes the alias route:
    // `const clock = Date; clock.now()` reads the clock through a member access the
    // scan never sees. Neither pure layer has any business naming Date at all.
    if (pureLayer && reference === 'Date' && (ts.isIdentifier(node) || ts.isElementAccessExpression(node))) {
      report(node, 'Pass the reference timestamp as an argument instead of naming Date (PLAN §6).');
    }
    if (from === 'domain') {
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        && isNamedReference(node.expression, 'Math') && memberName(node) === 'random') {
        report(node, 'Domain randomness must be deterministic from explicit inputs.');
      }
      // Math.floor and Math.log2 are load-bearing for the placement rules, so only the
      // aliasing form is banned: handing Math itself to a caller hides Math.random.
      if (reference === 'Math' && (ts.isIdentifier(node) || ts.isElementAccessExpression(node))
        && !isMemberAccessTarget(node)) {
        report(node, 'Domain may call Math members but must not alias Math itself.');
      }
    }
    if (reference === 'requestAnimationFrame' && filename !== frameOwner) {
      report(node, 'Only presentation/CityPresenter.ts may own requestAnimationFrame.');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

describe('starscraper architecture build gate', () => {
  it('has zero layer, purity, any, or frame-ownership violations in src', () => {
    const files = sourceFiles(sourceRoot);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(frameOwner);
    const violations = files.flatMap(filename => inspectSource(filename, readFileSync(filename, 'utf8')));
    expect(violations, violations.join('\n')).toEqual([]);
    const ownerSource = ts.createSourceFile(frameOwner, readFileSync(frameOwner, 'utf8'), ts.ScriptTarget.Latest, true);
    let ownsFrame = false;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === 'requestAnimationFrame') ownsFrame = true;
      ts.forEachChild(node, visit);
    };
    visit(ownerSource);
    expect(ownsFrame, 'CityPresenter must own the drawing loop').toBe(true);
  });

  it.each([
    "import { ThreeCityRenderer } from '../presentation/three/ThreeCityRenderer';",
    "export { ThreeCityRenderer } from '../presentation/three/ThreeCityRenderer';",
    "import forbidden = require('../presentation/three/ThreeCityRenderer');",
    "const forbidden = require('../presentation/three/ThreeCityRenderer');",
    "const forbidden = import('../presentation/three/ThreeCityRenderer');",
    "type Forbidden = import('../presentation/three/ThreeCityRenderer').ThreeCityRenderer;",
    'const forbidden = import(moduleName);',
  ])('detects forbidden dependency syntax: %s', source => {
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), source)).toHaveLength(1);
  });

  it.each([...browserGlobals])('detects browser reference %s in both pure layers', name => {
    for (const layer of ['domain', 'application']) {
      for (const reference of [name, `globalThis.${name}`, `globalThis['${name}']`]) {
        expect(inspectSource(path.join(sourceRoot, layer, 'probe.ts'), `void ${reference};`)
          .some(message => message.includes('Forbidden browser reference'))).toBe(true);
      }
    }
  });

  it('checks the complete dependency matrix and only exempts main.ts for wiring', () => {
    for (const from of Object.keys(allowed) as Layer[]) {
      for (const to of Object.keys(allowed) as Layer[]) {
        const violations = inspectSource(path.join(sourceRoot, from, 'probe.ts'), `export * from '../${to}/probe';`);
        expect(violations.length, `${from} -> ${to}`).toBe(allowed[from].includes(to) ? 0 : 1);
      }
    }
    expect(inspectSource(compositionRoot, "import 'three'; import './domain/model/Repository'; void document;")).toEqual([]);
    expect(inspectSource(path.join(sourceRoot, 'presentation/probe.ts'),
      "import 'three'; import 'three/addons/controls/OrbitControls.js';")).toEqual([]);
    for (const layer of ['domain', 'application', 'infrastructure']) {
      expect(inspectSource(path.join(sourceRoot, layer, 'probe.ts'), "import 'three';")).toHaveLength(1);
    }
    expect(inspectSource(path.join(sourceRoot, 'presentation/hud/probe.ts'), "import './city.css';")).toEqual([]);
    expect(inspectSource(path.join(sourceRoot, 'presentation/main.ts'), "import '../domain/model/Repository';")).toHaveLength(1);
  });

  it.each(['Date.now()', "Date['now']()", 'new Date()', 'new globalThis.Date()', 'globalThis.Date.now()'])
    ('rejects implicit reference time in domain and application: %s', source => {
      for (const layer of ['domain', 'application']) {
        expect(inspectSource(path.join(sourceRoot, layer, 'probe.ts'), source)).not.toEqual([]);
      }
      expect(inspectSource(path.join(sourceRoot, 'infrastructure/probe.ts'), source)).toEqual([]);
    });

  it('enforces domain Date isolation and deterministic randomness', () => {
    for (const source of ['Date.parse(value)', 'Math.random()', "Math['random']()", 'globalThis.Math.random()']) {
      expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), source)).not.toEqual([]);
    }
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), 'const age = (now: number, pushedAt: number) => now - pushedAt;')).toEqual([]);
  });

  it.each([
    'const clock = Date; export const time = () => clock.now();',
    'export const time = (clock: { now(): number }) => clock.now(); time(Date);',
    'const { now } = Date;',
    "const clock = globalThis['Date'];",
  ])('closes the alias route around the reference-time ban: %s', source => {
    for (const layer of ['domain', 'application']) {
      expect(inspectSource(path.join(sourceRoot, layer, 'probe.ts'), source)).not.toEqual([]);
    }
  });

  it.each([
    'const rng = Math; export const next = () => rng.random();',
    'export const pick = (source: Math) => source.random(); pick(Math);',
    "const rng = globalThis['Math'];",
  ])('closes the alias route around domain randomness: %s', source => {
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), source)).not.toEqual([]);
  });

  it('still lets the placement rules call Math members directly', () => {
    // Height uses a logarithm and footprints floor to whole cells, so a blanket ban on
    // Math would outlaw the very rules this project is built on.
    const source = 'export const height = (stars: number) => 4 + 6 * Math.log2(stars + 1);'
      + ' export const cells = (size: number) => Math.max(1, Math.floor(size / 2.4));'
      + " export const wide = (size: number) => globalThis['Math'].ceil(size);";
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), source)).toEqual([]);
  });

  it('refuses production imports of unscanned test modules', () => {
    for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
      expect(inspectSource(path.join(sourceRoot, layer, 'probe.ts'),
        "export { anything } from './bridge.test';")).toHaveLength(1);
    }
  });

  it('bans explicit any in all source layers and the composition root', () => {
    for (const filename of [compositionRoot, ...Object.keys(allowed).map(layer => path.join(sourceRoot, layer, 'probe.ts'))]) {
      expect(inspectSource(filename, 'let value: any;')).toHaveLength(1);
    }
  });

  it('restricts RAF to the exact CityPresenter path, including infrastructure and computed access', () => {
    for (const filename of ['presentation/three/probe.ts', 'presentation/input/CityPresenter.ts',
      'presentation/GamePresenter.ts', 'infrastructure/probe.ts', 'main.ts']) {
      for (const source of ['requestAnimationFrame(tick)', "globalThis['requestAnimationFrame'](tick)"]) {
        expect(inspectSource(path.join(sourceRoot, filename), source)).toHaveLength(1);
      }
    }
    expect(inspectSource(frameOwner, 'requestAnimationFrame(tick)')).toEqual([]);
  });

  it('ignores comments and string literals and excludes test files', () => {
    const text = '// window Date.now() Math.random() requestAnimationFrame any\nconst message = "document new Date()";';
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.ts'), text)).toEqual([]);
    expect(inspectSource(path.join(sourceRoot, 'domain/probe.test.ts'), 'void window;')).toEqual([]);
  });
});
