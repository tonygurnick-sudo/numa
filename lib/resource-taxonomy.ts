// Shared taxonomy for persona / industry tagging across Agents, Ops Boards, and KBs.
//
// Source of truth for TypeScript code: ./resource-taxonomy.json.
// Python equivalent (Numa KB lambda): lib/kb-core/kb_core/resource_taxonomy.py
//   — keep that file in sync if the values change.
import { z } from 'zod';
import taxonomy from './resource-taxonomy.json';

export const PERSONAS: readonly string[] = taxonomy.personas;
export const INDUSTRIES: readonly string[] = taxonomy.industries;

export type Persona = string;
export type Industry = string;

// Strict Zod schemas — exact (case-sensitive) match against the taxonomy.
export const personaSchema = z.enum(taxonomy.personas as [string, ...string[]]);
export const industrySchema = z.enum(taxonomy.industries as [string, ...string[]]);
export const personasArraySchema = z.array(personaSchema);
export const industriesArraySchema = z.array(industrySchema);

export type NormaliseResult = { values: string[]; invalid: string[] };

const normaliseAgainst = (input: unknown, allowed: readonly string[]): NormaliseResult => {
  if (!Array.isArray(input)) return { values: [], invalid: [] };
  const lowerToCanonical = new Map(allowed.map((v) => [v.toLowerCase(), v]));
  const seen = new Set<string>();
  const values: string[] = [];
  const invalid: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const canonical = lowerToCanonical.get(trimmed.toLowerCase());
    if (!canonical) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    values.push(canonical);
  }
  return { values, invalid };
};

// Lenient on whitespace and case, strict on membership.
// Callers decide whether to reject when invalid.length > 0.
export const normalisePersonas = (input: unknown): NormaliseResult => normaliseAgainst(input, PERSONAS);
export const normaliseIndustries = (input: unknown): NormaliseResult => normaliseAgainst(input, INDUSTRIES);
