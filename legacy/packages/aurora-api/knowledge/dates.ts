/**
 * Datas mostradas ao modelo. O servidor compara vigência por instante (ISO em UTC), mas o modelo
 * raciocina em datas de calendário: mandar o instante UTC faz uma fonte vigente parecer futura
 * perto da meia-noite. Por isso os prompts usam a data local da instalação e informam "hoje"
 * no mesmo fuso.
 */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
