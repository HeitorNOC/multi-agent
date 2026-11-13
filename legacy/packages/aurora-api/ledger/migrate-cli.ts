/**
 * Migra uma instalação SQLite para PostgreSQL.
 *
 *   node packages/aurora-api/ledger/migrate-cli.ts \
 *     --state <diretorio-de-estado> --url <postgres://...> --installation <id> \
 *     [--schema <nome>] [--dry-run]
 *
 * Pare o servidor da instalação antes. Use --dry-run primeiro: executa e verifica tudo, e
 * desfaz no fim. A origem nunca é alterada; para voltar atrás basta remover `ledger` da
 * configuração.
 */
import { MigrationError, migrateSqliteToPostgres } from "./sqlite-to-postgres.ts";

function parse(argv: string[]) {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new MigrationError(`Argumento inesperado: ${arg}`);
    const name = arg.slice(2);
    if (name === "dry-run") options[name] = true;
    else {
      const value = argv[++i];
      if (value === undefined) throw new MigrationError(`Falta o valor de --${name}`);
      options[name] = value;
    }
  }
  return options;
}

try {
  const o = parse(process.argv.slice(2));
  for (const required of ["state", "url", "installation"])
    if (typeof o[required] !== "string") throw new MigrationError(`Informe --${required}`);
  const report = await migrateSqliteToPostgres({
    stateDir: o.state as string,
    connectionString: o.url as string,
    schema: o.schema as string | undefined,
    installation: o.installation as string,
    dryRun: o["dry-run"] === true,
  });
  console.log(report.dryRun ? "Simulação concluída (nada foi gravado):" : "Migração concluída:");
  for (const t of report.tables) console.log(`  ${t.table.padEnd(32)} ${String(t.rows).padStart(7)} linhas  ${t.digest.slice(0, 16)}`);
  console.log(`  ordem dos trabalhos verificada: ${report.jobOrderVerified ? "sim" : "não"}`);
  if (report.legacyEventsBackfilled)
    console.log(`  eventos de banco antigo com identidade legada: ${report.legacyEventsBackfilled}`);
  if (!report.dryRun)
    console.log('Aponte a instalação para o PostgreSQL com { "ledger": { "driver": "postgres", ... } } e inicie o servidor.');
} catch (error) {
  console.error(`Falha: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
