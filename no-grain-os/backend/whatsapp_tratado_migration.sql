-- Adiciona coluna "tratado" em whatsapp_timeline para o botao [Tratado] do Radar WhatsApp.
-- Mensagem marcada como tratada some da fila padrao mas continua arquivada no banco.

ALTER TABLE public.whatsapp_timeline ADD COLUMN IF NOT EXISTS tratado BOOLEAN NOT NULL DEFAULT false;
