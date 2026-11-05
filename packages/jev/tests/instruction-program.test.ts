import { describe, expect, it } from 'vitest'
import { analyzeRequestedProgram } from '../src/instruction-program.ts'

describe('bounded requested program facts', () => {
  it('identifies a requested filesystem read and a constant path without executing it', () => {
    const result = analyzeRequestedProgram(`const fs = await import('node:fs'); const p = '/tmp/jev-synthetic-missing-file'; console.log(fs.readFileSync(p, 'utf8'));`)
    expect(result).toMatchObject({ parsed: true, unresolvedCalls: 0 })
    expect(result.calls).toEqual([{ api: 'node:fs.readFileSync', effect: 'read', path: '/tmp/jev-synthetic-missing-file' }])
  })
  it('identifies requested writes and both forms of promises imports', () => {
    expect(analyzeRequestedProgram(`const f = await import('fs'); f.writeFileSync('/tmp/a', 'x');`).calls).toEqual([{ api: 'node:fs.writeFileSync', effect: 'may-modify', path: '/tmp/a' }])
    expect(analyzeRequestedProgram(`const f = await import('node:fs'); await f.promises.readFile('/tmp/a');`).calls[0]).toMatchObject({ api: 'node:fs.promises.readFile', effect: 'read' })
    expect(analyzeRequestedProgram(`const f = await import('fs/promises'); await f.readFile('/tmp/a');`).calls[0]).toMatchObject({ api: 'node:fs.promises.readFile', effect: 'read' })
    expect(analyzeRequestedProgram(`import { readFileSync as read } from 'node:fs'; read('/tmp/a');`).calls[0]).toMatchObject({ api: 'node:fs.readFileSync', effect: 'read' })
  })
  it('does not extract fake calls from comments or strings', () => {
    expect(analyzeRequestedProgram(`/* fs.writeFileSync('/tmp/a', 'x') */ console.log("fs.readFileSync('/tmp/a')");`).calls).toEqual([])
  })
  it.each([
    `const fs=await import('node:fs'); function f(fs){ fs.readFileSync('/tmp/a') }`,
    `let fs=await import('node:fs'); fs=other; fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); fs.readFileSync=other; fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); eval('fs.readFileSync=other'); fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); fs[method]=other; fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); Object.assign(fs, replacement); fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); Object.defineProperty(fs, 'readFileSync', replacement); fs.readFileSync('/tmp/a');`,
    `const fs=await import('node:fs'); delete fs.readFileSync; fs.readFileSync('/tmp/a');`,
  ])('does not claim a known module operation through a mutable/shadowed alias', code => {
    const result=analyzeRequestedProgram(code)
    expect(result.calls).toEqual([])
    expect(result.unresolvedCalls).toBeGreaterThan(0)
  })
  it('retains dynamic imports, computed calls and process execution as unresolved', () => {
    const result=analyzeRequestedProgram(`const fs=await import('node:fs'); const cp=await import('node:child_process'); fs[method]('/tmp/a'); cp.execSync('true'); await import(moduleName);`)
    expect(result.calls).toEqual([])
    expect(result.unresolvedCalls).toBeGreaterThanOrEqual(3)
  })
  it('does not discard an unrelated visible call when a different call is unresolved', () => {
    const result=analyzeRequestedProgram(`const fs=await import('node:fs'); fs.readFileSync('/tmp/a'); unknown();`)
    expect(result.calls).toEqual([{ api: 'node:fs.readFileSync', effect: 'read', path: '/tmp/a' }])
    expect(result.unresolvedCalls).toBe(1)
  })
  it('does not infer dynamic path values or branch execution', () => {
    const result=analyzeRequestedProgram(`const fs=await import('node:fs'); if(false) fs.writeFileSync(computePath(), 'x');`)
    expect(result.calls).toEqual([{ api: 'node:fs.writeFileSync', effect: 'may-modify' }])
    expect(result.notes.join(' ')).toContain('requested calls, not execution')
  })
  it('rejects malformed and oversized syntax without partial claimed facts', () => {
    expect(analyzeRequestedProgram('const broken =')).toMatchObject({ parsed:false,calls:[] })
    expect(analyzeRequestedProgram(' '.repeat(20001))).toMatchObject({ parsed:false,calls:[] })
    expect(analyzeRequestedProgram(`const fs=await import('node:fs');`+`fs.readFileSync('/tmp/a');`.repeat(65))).toMatchObject({parsed:false,calls:[]})
  })
})
