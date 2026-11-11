/** Catálogo de personas prontas, agrupadas por área. É conteúdo do produto (arquivo JSON), não dado da empresa. */
import { readFileSync } from "node:fs";
import { z } from "zod";

export interface AgentTemplate {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly area: string;
  readonly tagline: string;
  readonly focus: string;
  readonly skills: readonly string[];
  /** O que o agente faz, em frases curtas (o Chief of Staff usa para escolher quem escalar). */
  readonly responsibilities: readonly string[];
  /** O que ele costuma entregar. */
  readonly deliverables: readonly string[];
}

export interface AgentArea {
  readonly id: string;
  readonly title: string;
}

export interface TemplateCatalog {
  readonly areas: readonly AgentArea[];
  readonly templates: readonly AgentTemplate[];
}

const schema = z
  .object({
    areas: z.array(z.object({ id: z.string().regex(/^[a-z_]{1,40}$/), title: z.string().min(1) })).min(1),
    templates: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{1,80}$/).refine((id) => !id.startsWith("custom_"), "prefixo reservado"),
        name: z.string().min(1).max(60),
        title: z.string().min(1).max(100),
        area: z.string(),
        tagline: z.string().max(160),
        focus: z.string().min(1).max(400),
        skills: z.array(z.string().min(1).max(60)).max(8),
        responsibilities: z.array(z.string().min(1).max(200)).min(2).max(6),
        deliverables: z.array(z.string().min(1).max(120)).min(1).max(5),
      }),
    ),
  })
  .refine((c) => new Set(c.templates.map((t) => t.id)).size === c.templates.length, "ids de persona repetidos")
  .refine((c) => c.templates.every((t) => c.areas.some((a) => a.id === t.area)), "persona com área desconhecida");

/** Lê e valida o catálogo; um arquivo inválido impede a API de subir com dados errados. */
export function loadTemplates(path: string | URL): TemplateCatalog {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}
