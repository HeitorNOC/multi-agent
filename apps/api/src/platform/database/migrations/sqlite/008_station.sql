-- Estação: conversa direta com um agente do time, com as citações de cada resposta.
ALTER TABLE conversations ADD COLUMN agent_id TEXT;
ALTER TABLE conversation_messages ADD COLUMN citations TEXT;
