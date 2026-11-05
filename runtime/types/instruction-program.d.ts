export interface RequestedProgram {
    parsed: boolean;
    calls: {
        api: string;
        effect: 'read' | 'may-modify';
        path?: string;
    }[];
    unresolvedCalls: number;
    notes: string[];
}
export declare function analyzeRequestedProgram(code: string): RequestedProgram;
//# sourceMappingURL=instruction-program.d.ts.map