/** Requested JavaScript calls only: never executes code or proves program safety. */
import { parse } from 'acorn'

type Tree = { type: string; [key: string]: unknown }
export interface RequestedProgram {
  parsed: boolean
  calls: { api: string; effect: 'read' | 'may-modify'; path?: string }[]
  unresolvedCalls: number
  notes: string[]
}
const READ = new Set(['readFile', 'readFileSync', 'readdir', 'readdirSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'existsSync', 'realpath', 'realpathSync', 'readlink', 'readlinkSync'])
const WRITE = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync', 'chmod', 'chmodSync', 'truncate', 'truncateSync', 'link', 'linkSync', 'symlink', 'symlinkSync'])
const MULTI_PATH = new Set(['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync', 'symlink', 'symlinkSync'])
const NON_FILE = new Set(['console.log', 'console.info', 'console.warn', 'console.error', 'JSON.parse', 'JSON.stringify'])
const tree = (value: unknown): Tree | undefined => typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string' ? value as Tree : undefined
const array = (value: unknown): Tree[] => Array.isArray(value) ? value.flatMap(value => tree(value) ?? []) : []
const literal = (value: unknown): string | undefined => { const node = tree(value); return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined }
const identifier = (value: unknown): string | undefined => { const node = tree(value); return node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : undefined }
function member(value: unknown): string[] | undefined {
  const node = tree(value)
  if (node?.type === 'Identifier') return [String(node.name)]
  if (node?.type !== 'MemberExpression' || node.optional === true) return undefined
  const base = member(node.object)
  const key = node.computed === true ? literal(node.property) : identifier(node.property)
  return base === undefined || key === undefined ? undefined : [...base, key]
}
function objectRoot(value: unknown): string | undefined {
  let node = tree(value)
  while (node?.type === 'MemberExpression') node = tree(node.object)
  return identifier(node)
}
function names(value: unknown): string[] {
  const node = tree(value)
  if (node === undefined) return []
  if (node.type === 'Identifier') return [String(node.name)]
  if (node.type === 'ObjectPattern') return array(node.properties).flatMap(part => names(part.type === 'RestElement' ? part.argument : part.value))
  if (node.type === 'ArrayPattern') return array(node.elements).flatMap(names)
  if (node.type === 'AssignmentPattern') return names(node.left)
  if (node.type === 'RestElement') return names(node.argument)
  return []
}
function moduleName(value: unknown): string | undefined {
  const node = tree(value)
  const imported = node?.type === 'AwaitExpression' ? tree(node.argument) : node
  return imported?.type === 'ImportExpression' ? literal(imported.source) : undefined
}
function fsModule(name: string | undefined): string | undefined {
  if (name === 'fs' || name === 'node:fs') return 'node:fs'
  if (name === 'fs/promises' || name === 'node:fs/promises') return 'node:fs.promises'
  return undefined
}

export function analyzeRequestedProgram(code: string): RequestedProgram {
  const failure = (note: string): RequestedProgram => ({ parsed: false, calls: [], unresolvedCalls: 1, notes: [note] })
  if (code.length > 20000) return failure('Program exceeds the syntax-evidence character budget')
  let program: Tree
  try { program = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }) as unknown as Tree }
  catch { return failure('Program syntax could not be parsed; effects remain unknown') }
  const nodes: Tree[] = [], stack = [program]
  while (stack.length) {
    const node = stack.pop()!
    nodes.push(node)
    if (nodes.length > 4096) return failure('Program exceeds the syntax-evidence node budget')
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) { const next = tree(child); if (next) stack.push(next) }
      else { const next = tree(value); if (next) stack.push(next) }
    }
  }
  const aliases = new Map<string, string>(), strings = new Map<string, string>(), declarations = new Map<string, number>(), invalid = new Set<string>()
  const declare = (value: unknown): void => { for (const name of names(value)) declarations.set(name, (declarations.get(name) ?? 0) + 1) }
  for (const node of nodes) {
    if (node.type === 'VariableDeclarator') declare(node.id)
    if (node.type.startsWith('Import') && node.type.endsWith('Specifier')) declare(node.local)
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) { if (node.id) declare(node.id); for (const param of array(node.params)) declare(param) }
    if (node.type === 'ClassDeclaration' && node.id) declare(node.id)
    if (node.type === 'CatchClause') declare(node.param)
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = node.type === 'AssignmentExpression' ? node.left : node.argument
      const base = objectRoot(target)
      if (base !== undefined) invalid.add(base)
      else for (const name of names(target)) invalid.add(name)
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') { const base = objectRoot(node.argument); if (base) invalid.add(base) }
    if (node.type === 'CallExpression' && ['Object.assign', 'Object.defineProperty', 'Object.defineProperties', 'Reflect.set', 'Reflect.defineProperty', 'Reflect.deleteProperty'].includes(member(node.callee)?.join('.') ?? '')) {
      const args = Array.isArray(node.arguments) ? node.arguments : []
      const base = objectRoot(args[0]); if (base) invalid.add(base)
    }
  }
  for (const statement of array(program.body)) {
    if (statement.type === 'VariableDeclaration' && statement.kind === 'const') for (const declaration of array(statement.declarations)) {
      const name = identifier(declaration.id), module = fsModule(moduleName(declaration.init)), value = literal(declaration.init)
      if (name !== undefined && module !== undefined) aliases.set(name, module)
      if (name !== undefined && value !== undefined) strings.set(name, value)
    }
    if (statement.type === 'ImportDeclaration') {
      const module = fsModule(literal(statement.source))
      if (module !== undefined) for (const specifier of array(statement.specifiers)) {
        const name = identifier(specifier.local)
        if (name === undefined) continue
        if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') aliases.set(name, module)
        else { const imported = identifier(specifier.imported); if (imported) aliases.set(name, module + '.' + imported) }
      }
    }
  }
  const notes = ['Syntax evidence describes requested calls, not execution or whole-program read-only safety']
  const opaqueEval = nodes.some(node => node.type === 'CallExpression' && identifier(node.callee) === 'eval' || node.type === 'NewExpression' && identifier(node.callee) === 'Function')
  for (const name of new Set([...aliases.keys(), ...strings.keys()])) if ((declarations.get(name) ?? 0) !== 1 || invalid.has(name) || opaqueEval) {
    aliases.delete(name); strings.delete(name)
    if (notes.length < 16) notes.push('An alias or literal path was shadowed, reassigned, or exposed to dynamic evaluation')
  }
  const calls: RequestedProgram['calls'] = []
  let unresolvedCalls = 0
  for (const node of nodes) {
    if (node.type === 'ImportExpression') { if (fsModule(literal(node.source)) === undefined) unresolvedCalls++; continue }
    if (node.type === 'NewExpression') { unresolvedCalls++; continue }
    if (node.type !== 'CallExpression') continue
    const parts = member(node.callee)
    if (parts === undefined || node.optional === true) { unresolvedCalls++; continue }
    const base = aliases.get(parts[0]!)
    if (base === undefined) {
      if (!NON_FILE.has(parts.join('.')) || declarations.has(parts[0]!) || invalid.has(parts[0]!)) unresolvedCalls++
      continue
    }
    const api = [base, ...parts.slice(1)].join('.'), method = api.split('.').at(-1)!
    if (!/^node:fs(?:\.promises)?\.[^.]+$/.test(api) || !READ.has(method) && !WRITE.has(method)) { unresolvedCalls++; continue }
    const args = Array.isArray(node.arguments) ? node.arguments : []
    const first = args[0], path = MULTI_PATH.has(method) ? undefined : literal(first) ?? strings.get(identifier(first) ?? '')
    calls.push({ api, effect: READ.has(method) ? 'read' : 'may-modify', ...path === undefined ? {} : { path } })
    if (calls.length > 64) return failure('Program exceeds the requested-call evidence budget')
    if (MULTI_PATH.has(method)) unresolvedCalls++
  }
  return { parsed: true, calls, unresolvedCalls, notes }
}
