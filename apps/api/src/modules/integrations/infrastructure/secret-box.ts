/**
 * Cofre dos segredos das conexões (tokens do Google, do Slack). Cifra com AES-256-GCM; a chave
 * fica FORA do banco: na variável AURORA_SECRET_KEY (64 hex) ou num arquivo criado na primeira vez
 * (`data/aurora.key`, só leitura para o dono). Quem copia só o banco não lê nenhum token.
 *
 * Os segredos nunca saem pela API e nunca vão para a trilha de eventos.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SecretBox {
  /** Identifica a chave (hash curto), para saber com qual chave um segredo foi cifrado. */
  readonly keyId: string;
  seal(plain: string): string;
  open(sealed: string): string;
}

export function secretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("A chave do cofre precisa de 32 bytes");
  const keyId = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return {
    keyId,
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return ["v1", keyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
    },
    open(sealed) {
      const [version, id, iv, tag, body] = sealed.split(".");
      if (version !== "v1" || !iv || !tag || body === undefined) throw new Error("Segredo em formato desconhecido");
      if (id !== keyId) throw new Error("Segredo cifrado com outra chave");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}

/** A chave da variável de ambiente, ou a do arquivo (criada na primeira vez). */
export function loadSecretKey(options: { hex?: string; file: string }): Buffer {
  if (options.hex) {
    if (!/^[0-9a-f]{64}$/i.test(options.hex)) throw new Error("AURORA_SECRET_KEY precisa ter 64 caracteres hexadecimais");
    return Buffer.from(options.hex, "hex");
  }
  if (existsSync(options.file)) return Buffer.from(readFileSync(options.file, "utf8").trim(), "hex");
  mkdirSync(dirname(options.file), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(options.file, key.toString("hex"), { mode: 0o600, flag: "wx" });
  try {
    chmodSync(options.file, 0o600);
  } catch {
    // Windows: as permissões seguem as da pasta do usuário.
  }
  return key;
}
