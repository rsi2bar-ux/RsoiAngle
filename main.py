import os, asyncio, threading, time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional
import requests
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
IST = ZoneInfo('Asia/Kolkata')
app = FastAPI(title='Angel One RSI Sniper API', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=False, allow_methods=['*'], allow_headers=['*'])

# Credentials stay on the backend. Never place API key, PIN, or TOTP secret in frontend code.
ANGEL_API_KEY = os.getenv('ANGEL_API_KEY', '')
CLIENT_CODE = os.getenv('ANGEL_CLIENT_CODE', '')
PIN = os.getenv('ANGEL_PIN', '')
TOTP_SECRET = os.getenv('ANGEL_TOTP_SECRET', '')
ENABLE_LIVE_LOGIN = os.getenv('ENABLE_LIVE_LOGIN', 'false').lower() == 'true'
session = {'obj': None, 'jwt': None, 'feed': None, 'client_code': CLIENT_CODE, 'last_login': None, 'error': None}

class CandleRequest(BaseModel):
    exchange: str = 'NSE'
    symboltoken: str = '99926000'  # NIFTY 50 index token; verify against current Angel One scrip master
    interval: str = 'ONE_MINUTE'
    days: int = 3

class OIRequest(BaseModel):
    tokens: list[str]
    exchange: str = 'NFO'

class StrategySettings(BaseModel):
    rsi_length: int = 14
    rsi_sma_length: int = 9
    oi_lookback: int = 3
    oi_full_pct: float = 1.0
    threshold: float = 70.0
    strike_count_each_side: int = 10


def angel_login():
    if not all([ANGEL_API_KEY, CLIENT_CODE, PIN, TOTP_SECRET]):
        raise RuntimeError('Missing Angel One credentials in backend .env')
    import pyotp
    from SmartApi import SmartConnect
    api = SmartConnect(api_key=ANGEL_API_KEY)
    result = api.generateSession(CLIENT_CODE, PIN, pyotp.TOTP(TOTP_SECRET).now())
    if not result or not result.get('status'):
        raise RuntimeError(f'Angel One login failed: {result}')
    session['obj'] = api
    session['jwt'] = result['data']['jwtToken']
    session['feed'] = api.getfeedToken()
    session['last_login'] = datetime.now(IST).isoformat()
    session['error'] = None
    return result

@app.on_event('startup')
async def startup():
    if ENABLE_LIVE_LOGIN:
        try: angel_login()
        except Exception as e: session['error'] = str(e)

@app.get('/api/health')
def health():
    return {'ok': True, 'service': 'angelone-rsi-sniper', 'version': app.version, 'market_time': datetime.now(IST).isoformat(), 'authenticated': session['obj'] is not None, 'login_error': session['error']}

@app.post('/api/auth/login')
def login():
    try:
        angel_login()
        return {'ok': True, 'authenticated': True, 'login_time': session['last_login']}
    except Exception as e:
        session['error'] = str(e)
        raise HTTPException(502, str(e))

@app.post('/api/candles')
def candles(req: CandleRequest):
    if session['obj'] is None: raise HTTPException(401, 'Backend is not authenticated. Configure .env and call /api/auth/login.')
    intervals = {'1m':'ONE_MINUTE','3m':'THREE_MINUTE','5m':'FIVE_MINUTE','15m':'FIFTEEN_MINUTE','30m':'THIRTY_MINUTE','1h':'ONE_HOUR'}
    interval = intervals.get(req.interval.lower(), req.interval.upper())
    end = datetime.now(IST); start = end - timedelta(days=max(1, min(req.days, 30)))
    body = {'exchange':req.exchange, 'symboltoken':req.symboltoken, 'interval':interval, 'fromdate':start.strftime('%Y-%m-%d %H:%M'), 'todate':end.strftime('%Y-%m-%d %H:%M')}
    try:
        out = session['obj'].getCandleData(body)
        if not out.get('status'): raise RuntimeError(out)
        rows = [{'time':int(datetime.fromisoformat(x[0]).timestamp()),'open':float(x[1]),'high':float(x[2]),'low':float(x[3]),'close':float(x[4]),'volume':float(x[5] or 0)} for x in out.get('data',[])]
        return {'ok':True,'candles':rows,'count':len(rows),'interval':interval}
    except Exception as e: raise HTTPException(502, f'Angel One candle request failed: {e}')

@app.post('/api/oi/quote')
def oi_quote(req: OIRequest):
    if session['obj'] is None: raise HTTPException(401, 'Backend is not authenticated')
    if not req.tokens or len(req.tokens) > 50: raise HTTPException(400, 'Supply 1 to 50 option tokens')
    try:
        # FULL mode contains opnInterest for each live F&O contract.
        data = session['obj'].getMarketData('FULL', {req.exchange:req.tokens})
        if not data.get('status'): raise RuntimeError(data)
        return {'ok':True,'data':data.get('data',{}).get('fetched',[]),'unfetched':data.get('data',{}).get('unfetched',[])}
    except Exception as e: raise HTTPException(502, f'Angel One OI quote failed: {e}')

@app.post('/api/oi/history')
def oi_history(req: dict):
    if session['obj'] is None: raise HTTPException(401, 'Backend is not authenticated')
    try:
        result = session['obj'].getOIData({'exchange':req.get('exchange','NFO'),'symboltoken':str(req['symboltoken']),'interval':req.get('interval','ONE_MINUTE'),'fromdate':req['fromdate'],'todate':req['todate']})
        if not result.get('status'): raise RuntimeError(result)
        return {'ok':True,'data':result.get('data',[])}
    except Exception as e: raise HTTPException(502, f'Angel One historical OI failed: {e}')

@app.post('/api/option-greeks')
def option_greeks(req: dict):
    if session['obj'] is None: raise HTTPException(401, 'Backend is not authenticated')
    try:
        result = session['obj'].optionGreek({'name':req.get('name','NIFTY'),'expirydate':req['expirydate']})
        if not result.get('status'): raise RuntimeError(result)
        return {'ok':True,'data':result.get('data',[])}
    except Exception as e: raise HTTPException(502, f'Angel One Greeks request failed: {e}')

@app.post('/api/strategy/calculate')
def strategy(payload: dict):
    """Pure strategy endpoint. Input candles + real per-contract OI observations; no fabricated OI."""
    from strategy import calculate
    try: return calculate(payload)
    except Exception as e: raise HTTPException(400, str(e))

@app.websocket('/ws/status')
async def ws_status(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json({'type':'status','authenticated':session['obj'] is not None,'time':datetime.now(IST).isoformat(),'error':session['error']})
            await asyncio.sleep(2)
    except WebSocketDisconnect: pass
