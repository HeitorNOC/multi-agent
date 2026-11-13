-- Fontes do Cérebro anexadas a um pedido (por exemplo, imagens enviadas na conversa).
-- Lista JSON de ids; os trechos delas chegam aos especialistas do trabalho com prioridade.
ALTER TABLE jobs ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
-- Imagens (e outros arquivos) anexadas a uma mensagem da conversa: lista JSON de {source, title}.
ALTER TABLE conversation_messages ADD COLUMN attachments TEXT;
