-- Executar em transação. Preserva os controles e não infere vínculos legados.
LOCK TABLE whatsapp_conversation_control IN SHARE ROW EXCLUSIVE MODE;

-- A variante histórica criou este índice como único; a variante atual permite
-- controles legados ambíguos, que continuam bloqueados até comprovação.
DROP INDEX whatsapp_control_conversation_identity;
CREATE INDEX whatsapp_control_conversation_identity
  ON whatsapp_conversation_control (tenant_id, phone_number_id, contact_id);

-- A FK NOT VALID não verifica necessariamente um UPDATE que mantém a chave.
-- O bloqueio do vínculo impede sua remoção durante a transação.
CREATE OR REPLACE FUNCTION whatsapp_require_control_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM whatsapp_phone_binding
    WHERE tenant_id = NEW.tenant_id
      AND integration_id = NEW.integration_id
      AND phone_number_id = NEW.phone_number_id
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Controle WhatsApp sem vínculo comprovado'
      USING ERRCODE = '23503', CONSTRAINT = 'whatsapp_control_phone_binding';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_control_require_binding ON whatsapp_conversation_control;
CREATE TRIGGER whatsapp_control_require_binding
  BEFORE INSERT OR UPDATE ON whatsapp_conversation_control
  FOR EACH ROW EXECUTE FUNCTION whatsapp_require_control_binding();
