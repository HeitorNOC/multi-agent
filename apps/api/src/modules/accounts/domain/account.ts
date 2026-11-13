/**
 * Contas de acesso. Uma conta é uma pessoa da empresa; o id dela (o e-mail normalizado) é o
 * `ActorId` usado no resto do sistema: dono e leitores de fontes, conversas, trilhas.
 *
 * Regras:
 *  - a primeira conta da instalação é a do dono e assume os dados do operador local;
 *  - depois dela, só entra quem o dono liberou (convite por e-mail), por senha ou Google/Microsoft;
 *  - uma conta externa (provedor + identificador) fica ligada a uma única conta.
 */
import { invalid } from "../../../shared/errors.ts";
import { ActorId } from "../../../shared/ids.ts";

export type Role = "owner" | "member";
export type Provider = "google" | "microsoft";
export const PROVIDERS: readonly Provider[] = ["google", "microsoft"];

export interface Account {
  readonly id: ActorId;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly passwordHash: string | null;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

export interface Invite {
  readonly email: string;
  readonly role: Role;
  readonly invitedBy: ActorId;
  readonly createdAt: string;
}

/** Quem usava o Aurora antes das contas; a primeira conta herda o que era dele. */
export const LOCAL_OPERATOR = ActorId.parse("operador-local");

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** E-mail em minúsculas e sem espaços; recusa o que não serve como identificador. */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 200 || !EMAIL.test(email)) throw invalid("invalid_email", "E-mail inválido");
  return email;
}

export function checkPassword(password: string) {
  if (password.length < PASSWORD_MIN) throw invalid("weak_password", `A senha precisa de pelo menos ${PASSWORD_MIN} caracteres`);
  if (password.length > PASSWORD_MAX) throw invalid("weak_password", "Senha longa demais");
}

export function cleanName(raw: string, email: string): string {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 100);
  return name || email.split("@")[0]!;
}

export const accountId = (email: string) => ActorId.parse(email);
