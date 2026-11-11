/**
 * Conector de pasta local. Regras de segurança:
 *  - a pasta precisa existir, ser absoluta e não ficar dentro da pasta de dados do Aurora;
 *  - só arquivos do primeiro nível, sem atalhos (symlinks) e sem sair da pasta (`..`, `/`);
 *  - leitura só de formatos que o Cérebro aceita e até o tamanho máximo;
 *  - escrita nunca sobrescreve: se o nome existe, ganha um sufixo " (2)", " (3)"…
 */
import { lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { ensure, invalid, notFound } from "../../../shared/errors.ts";
import type { Json } from "../../../shared/json.ts";

/** Arquivos que a pasta entrega ao Cérebro (os mesmos formatos aceitos no envio). */
export const READABLE = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export interface FolderFile {
  name: string;
  size_bytes: number;
  modified_at: string;
  media_type: string;
}

export interface FolderConfig {
  path: string;
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

export class LocalFolder {
  private readonly forbidden: readonly string[];
  private readonly maxBytes: number;

  /** `forbidden`: pastas que não podem ser conectadas (por exemplo, os dados do Aurora). */
  constructor(options: { forbidden: readonly string[]; maxBytes: number }) {
    this.forbidden = options.forbidden.map((p) => resolve(p));
    this.maxBytes = options.maxBytes;
  }

  /** Valida a configuração e devolve o caminho real da pasta. */
  async validate(config: Json): Promise<FolderConfig> {
    const path = (config as { path?: unknown } | null)?.path;
    ensure(typeof path === "string" && path.length <= 500 && isAbsolute(path), () => invalid("invalid_folder", "Informe o caminho completo de uma pasta"));
    let real: string;
    try {
      real = await realpath(path);
      ensure((await lstat(real)).isDirectory(), () => invalid("invalid_folder", "O caminho não é uma pasta"));
    } catch (error) {
      if (error instanceof Error && "kind" in error) throw error;
      throw invalid("folder_not_found", "Pasta não encontrada neste computador");
    }
    for (const f of this.forbidden) ensure(!inside(real, f) && !inside(f, real), () => invalid("folder_forbidden", "Esta pasta não pode ser conectada (contém ou fica dentro dos dados do Aurora)"));
    return { path: real };
  }

  async list(config: FolderConfig): Promise<FolderFile[]> {
    const entries = await readdir(config.path, { withFileTypes: true });
    const files: FolderFile[] = [];
    for (const e of entries) {
      const type = READABLE[extname(e.name).toLowerCase() as keyof typeof READABLE];
      if (!e.isFile() || !type) continue; // isFile é falso para atalhos e pastas
      const info = await lstat(join(config.path, e.name));
      if (info.size > this.maxBytes) continue;
      files.push({ name: e.name, size_bytes: info.size, modified_at: info.mtime.toISOString(), media_type: type });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async read(config: FolderConfig, name: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const file = await this.resolveExisting(config, name);
    const type = READABLE[extname(name).toLowerCase() as keyof typeof READABLE];
    ensure(type, () => invalid("unsupported_file", "Formato não aceito pelo Cérebro"));
    const info = await lstat(file);
    ensure(info.size <= this.maxBytes, () => invalid("file_too_large", "Arquivo maior que o limite do Cérebro"));
    return { bytes: new Uint8Array(await readFile(file)), mediaType: type };
  }

  /** Grava sem sobrescrever; devolve o nome final. */
  async write(config: FolderConfig, name: string, text: string): Promise<string> {
    const safe = safeName(name);
    const ext = extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? safe : `${stem} (${n})${ext}`;
      try {
        await writeFile(join(config.path, candidate), text, { encoding: "utf8", flag: "wx" });
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw invalid("file_exists", "Já existem muitas versões deste arquivo na pasta");
  }

  private async resolveExisting(config: FolderConfig, name: string) {
    const safe = safeName(name);
    const file = join(config.path, safe);
    let real: string;
    try {
      real = await realpath(file);
    } catch {
      throw notFound("file_not_found", "Arquivo não encontrado na pasta");
    }
    const info = await lstat(file);
    ensure(!info.isSymbolicLink() && info.isFile() && inside(real, config.path), () => invalid("unsafe_file", "Arquivo fora da pasta conectada"));
    return real;
  }
}

/** Só um nome de arquivo, sem caminho nem caracteres que o Windows recusa. */
function safeName(name: string) {
  ensure(typeof name === "string" && name === basename(name) && !/[\\/:*?"<>|\0]/.test(name) && name !== "." && name !== ".." && name.length <= 200, () =>
    invalid("invalid_file_name", "Nome de arquivo inválido"),
  );
  return name;
}
