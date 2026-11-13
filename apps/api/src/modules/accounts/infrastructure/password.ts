/**
 * Hash de senha com scrypt (memória alta, sal por senha) e comparação em tempo constante.
 * Formato guardado: `scrypt$N$r$p$sal$hash` (base64url), para poder subir o custo no futuro.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;

const derive = (password: string, salt: Buffer, o: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) => {
    const options: ScryptOptions = { ...o, maxmem: 128 * o.N * o.r * 2 };
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ["scrypt", COST.N, COST.r, COST.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Sempre gasta o mesmo trabalho, exista ou não a conta (não revela quem tem cadastro). */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored ?? DUMMY).split("$");
  const [scheme, n, r, p, salt, hash] = parts;
  if (parts.length !== 6 || scheme !== "scrypt") return false;
  const expected = Buffer.from(hash!, "base64url");
  const key = await derive(password, Buffer.from(salt!, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
  return stored !== null && key.length === expected.length && timingSafeEqual(key, expected);
}

const DUMMY = ["scrypt", COST.N, COST.r, COST.p, "AAAAAAAAAAAAAAAAAAAAAA", "A".repeat(43)].join("$");
