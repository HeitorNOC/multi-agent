/**
 * Entrar com Google e Microsoft (OpenID Connect, fluxo de código com PKCE).
 *
 * O Aurora é um cliente confidencial: troca o código pelo `id_token` direto no endpoint do
 * provedor, por HTTPS e com o segredo do aplicativo. Por isso valida as declarações do token
 * (emissor, público, validade, nonce) sem baixar chaves (OIDC Core 3.1.3.7). Nenhum token de
 * acesso é guardado: o Aurora só quer saber quem é a pessoa.
 */
import { createHash, randomBytes } from "node:crypto";
import { unauthenticated } from "../../../shared/errors.ts";
import type { Provider } from "../domain/account.ts";

export interface ExternalPerson {
  readonly subject: string;
  /** Só quando o provedor garante que o e-mail é da pessoa; senão, nulo. */
  readonly email: string | null;
  readonly name: string;
}

export interface OidcProvider {
  readonly id: Provider;
  authorizationUrl(input: { redirectUri: string; state: string; nonce: string; challenge: string }): string;
  exchange(input: { code: string; redirectUri: string; verifier: string; nonce: string }): Promise<ExternalPerson>;
}

export interface OidcClientConfig {
  clientId: string;
  clientSecret: string;
}

type Fetch = typeof fetch;
type Claims = Record<string, unknown>;

/** Par PKCE: o verificador fica com o Aurora; o desafio vai ao provedor. */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const failed = (detail: string) => unauthenticated("oauth_failed", `Não foi possível entrar: ${detail}`);

abstract class OidcClient implements OidcProvider {
  abstract readonly id: Provider;
  protected abstract readonly authorizeEndpoint: string;
  protected abstract readonly tokenEndpoint: string;
  protected readonly config: OidcClientConfig;
  private readonly fetch: Fetch;
  private readonly now: () => number;

  constructor(config: OidcClientConfig, options: { fetch?: Fetch; now?: () => number } = {}) {
    this.config = config;
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  authorizationUrl(input: { redirectUri: string; state: string; nonce: string; challenge: string }) {
    const url = new URL(this.authorizeEndpoint);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: input.redirectUri,
      scope: "openid email profile",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.href;
  }

  async exchange(input: { code: string; redirectUri: string; verifier: string; nonce: string }): Promise<ExternalPerson> {
    let response: Response;
    try {
      response = await this.fetch(this.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code_verifier: input.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw failed("o provedor não respondeu");
    }
    const body = (await response.json().catch(() => ({}))) as { id_token?: unknown };
    if (!response.ok || typeof body.id_token !== "string") throw failed("o provedor recusou o código");
    const claims = decodePayload(body.id_token);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(this.config.clientId)) throw failed("token de outro aplicativo");
    if (typeof claims.exp !== "number" || claims.exp * 1000 < this.now() - 60_000) throw failed("token vencido");
    if (claims.nonce !== input.nonce) throw failed("token não corresponde a este pedido");
    if (typeof claims.sub !== "string" || !claims.sub) throw failed("token sem identificador");
    if (!this.trustedIssuer(claims)) throw failed("emissor desconhecido");
    const name = typeof claims.name === "string" ? claims.name : "";
    return { subject: claims.sub, email: this.verifiedEmail(claims), name };
  }

  protected abstract trustedIssuer(claims: Claims): boolean;
  protected abstract verifiedEmail(claims: Claims): string | null;
}

function decodePayload(token: string): Claims {
  const part = token.split(".")[1];
  try {
    const claims = JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as unknown;
    if (claims && typeof claims === "object") return claims as Claims;
  } catch {
    // cai no erro abaixo
  }
  throw failed("token ilegível");
}

export class GoogleOidc extends OidcClient {
  readonly id = "google" as const;
  protected readonly authorizeEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
  protected readonly tokenEndpoint = "https://oauth2.googleapis.com/token";
  protected trustedIssuer(c: Claims) {
    return c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
  }
  protected verifiedEmail(c: Claims) {
    return c.email_verified === true && typeof c.email === "string" ? c.email : null;
  }
}

/** Contas pessoais da Microsoft (outlook.com, hotmail.com): o e-mail é da própria Microsoft. */
const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

export class MicrosoftOidc extends OidcClient {
  readonly id = "microsoft" as const;
  private readonly tenant: string;
  protected readonly authorizeEndpoint: string;
  protected readonly tokenEndpoint: string;

  /** `tenant`: `common` (qualquer conta), `organizations`, ou o id (GUID) do diretório da empresa. */
  constructor(config: OidcClientConfig & { tenant: string }, options?: { fetch?: Fetch; now?: () => number }) {
    super(config, options);
    this.tenant = config.tenant;
    const base = `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0`;
    this.authorizeEndpoint = `${base}/authorize`;
    this.tokenEndpoint = `${base}/token`;
  }
  protected trustedIssuer(c: Claims) {
    return typeof c.tid === "string" && c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`;
  }
  /**
   * No Entra, o e-mail de uma conta pode ser editado pelo administrador do diretório dela. Só é
   * aceito para ligar contas quando é garantido: conta pessoal da Microsoft, diretório da própria
   * empresa (configurado) ou a declaração `xms_edov` (domínio verificado) presente.
   */
  protected verifiedEmail(c: Claims) {
    const email = typeof c.email === "string" ? c.email : null;
    const trusted = c.tid === CONSUMER_TENANT || c.tid === this.tenant || c.xms_edov === true;
    return trusted ? email : null;
  }
}
