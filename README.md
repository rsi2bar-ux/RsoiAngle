# Angel One RSI Sniper backend (starter)

## Run
1. Python 3.10+ recommended.
2. `python -m venv .venv` then activate it.
3. `pip install -r requirements.txt`
4. Copy `.env.example` to `.env`, fill Angel One credentials.
5. Start: `uvicorn main:app --host 0.0.0.0 --port 8000`
6. Open `/docs`; call `POST /api/auth/login` after market/API access is configured.

## Important implementation boundary
This starter includes authenticated REST adapters for candles, FULL quote OI, historical OI and Greeks, plus the strategy calculation core. It does **not yet include** production SmartWebSocketV2 binary tick decoding, automatic scrip-master expiry/strike discovery, persistent database, or guaranteed background push notifications. Those must be completed and tested against the user's Angel One account before calling this production/live-ready.

Never expose `.env` or credentials in frontend code or public GitHub repositories. Verify index tokens and current contract tokens against the current Angel One scrip master; do not assume a token remains valid forever.
