from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    OPENAI_API_KEY: str
    SUPABASE_URL: str
    SUPABASE_KEY: str
    QUALP_API_TOKEN: str = ""
    GOOGLE_SHEET_ID: str = ""
    GOOGLE_CREDENTIALS_PATH: str = "credentials.json"
    GMAIL_TOKEN_PATH: str = "token_gmail.json"
    GMAIL_SECRET_PATH: str = "client_secret_gmail.json"
    GOOGLE_SHEETS_TOKEN_PATH: str = "token_sheets.json"
    MARGEM_MINIMA_PCT: float = 10.0  # margem abaixo disso → APROV_DIRETORIA
    INTERNAL_NOTIFY_TOKEN: str = ""  # M49 — trava mínima do endpoint de notificação


settings = Settings()
