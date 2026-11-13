# Inspeção das respostas e do protocolo

As 12 respostas completas foram lidas depois da medição. Nos dois modos, Aurora respondeu alimentação R$240 e prazo 18h30; Boreal respondeu R$190 e três revisores; Celeste respondeu R$9.700.000 como limite de estudo, sem aquisição/pagamento concluído; hotel permaneceu sem valor definido. As datas de vigência/publicação foram distinguidas. Não se observou troca pelas regras conflitantes do outro manual. Isso complementa o grader lexical, sem ser avaliação independente, entailment automatizado por todas as afirmações ou prova estatística de qualidade.

O perfil de leitura não deve ser descrito como acelerador do modelo: ele remove espera de histórico imutável atrás de inferência ativa. As duas janelas tiveram duas chamadas CLI cada. O trabalho de IA continua serializado. O throughput de 80 leituras ou de uma rajada de oito não define capacidade sustentável empresarial.

O cenário de quota cheio mostrou comportamento ruim de disponibilidade no baseline: uma falha de geração deixou intenção pendente e levou o histórico a 503. Preflight evita o caso em que a quota já está cheia no início; não resolve falha/consumo parcial em tarefas longas. Sua indisponibilidade conservadora para novas respostas mesmo potencialmente em cache/abstenção é outra limitação.

O FAIL do E2E original é preservado: o caso final repetia um fingerprint fechado e esperava o código errado. A regressão complementar demonstra a proteção prioritária (409) e a recusa antecipada de um pedido novo (429) com histórico disponível. Essa regressão gera pela API um histórico de abstenção e não usa modelos/índice nativo, portanto não substitui a repetição completa da carga/corpus original.

A contagem inicial de zero arquivos não foi usada como prova final de zero consumo. A auditoria encontrou uma reserva sem saída/usage; uso incerto. A ausência da chave pública exportada da instalação cancelada também impede validar suas provas offline. Essas lacunas são reais na evidência de preparação, não motivo para preencher tokens ou assinaturas artificialmente.
