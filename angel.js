const axios = require("axios");
const { authenticator } = require("otplib");

const BASE = "https://apiconnect.angelone.in";
const client = axios.create({
  baseURL: BASE,
  timeout: Number(process.env.ANGEL_TIMEOUT_MS || 15000),
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": process.env.ANGEL_LOCAL_IP || "127.0.0.1",
    "X-ClientPublicIP": process.env.ANGEL_PUBLIC_IP || "127.0.0.1",
    "X-MACAddress": process.env.ANGEL_MAC_ADDRESS || "00:00:00:00:00:00"
  }
});

class AngelOne {
  constructor() {
    this.jwtToken = null;
    this.refreshToken = null;
    this.feedToken = null;
    this.clientCode = process.env.ANGEL_CLIENT_CODE || "";
    this.lastLoginAt = null;
    this.lastError = null;
  }

  get configured() {
    return Boolean(process.env.ANGEL_API_KEY && this.clientCode &&
      process.env.ANGEL_PIN && process.env.ANGEL_TOTP_SECRET);
  }

  headers() {
    if (!this.jwtToken) throw new Error("Angel One session is not authenticated");
    return {
      Authorization: `Bearer ${this.jwtToken}`,
      "X-PrivateKey": process.env.ANGEL_API_KEY,
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": process.env.ANGEL_LOCAL_IP || "127.0.0.1",
      "X-ClientPublicIP": process.env.ANGEL_PUBLIC_IP || "127.0.0.1",
      "X-MACAddress": process.env.ANGEL_MAC_ADDRESS || "00:00:00:00:00:00"
    };
  }

  async login() {
    if (!this.configured) throw new Error("Missing Angel One environment variables");
    const otp = authenticator.generate(process.env.ANGEL_TOTP_SECRET.replace(/\s/g, ""));
    const response = await client.post(
      "/rest/auth/angelbroking/user/v1/loginByPassword",
      { clientcode: this.clientCode, password: process.env.ANGEL_PIN, totp: otp },
      { headers: { "X-PrivateKey": process.env.ANGEL_API_KEY } }
    );
    const payload = response.data;
    if (!payload || payload.status !== true || !payload.data?.jwtToken) {
      throw new Error(payload?.message || "Angel One login failed; inspect SmartAPI credentials and TOTP");
    }
    this.jwtToken = payload.data.jwtToken;
    this.refreshToken = payload.data.refreshToken || null;
    this.feedToken = payload.data.feedToken || null;
    this.lastLoginAt = new Date().toISOString();
    this.lastError = null;
    return this.status();
  }

  status() {
    return {
      configured: this.configured,
      authenticated: Boolean(this.jwtToken),
      clientCode: this.clientCode || null,
      lastLoginAt: this.lastLoginAt,
      lastError: this.lastError
    };
  }

  async request(path, body) {
    if (!this.jwtToken) await this.login();
    try {
      const r = await client.post(path, body, { headers: this.headers() });
      if (r.data?.status === false) throw new Error(r.data.message || "SmartAPI request failed");
      return r.data?.data ?? r.data;
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.errorcode || err.message;
      if (err.response?.status === 401 || /token|session|unauthor/i.test(String(msg))) {
        this.jwtToken = null;
      }
      this.lastError = String(msg);
      throw new Error(String(msg));
    }
  }

  async candles({ exchange, symboltoken, interval, fromdate, todate }) {
    const data = await this.request(
      "/rest/secure/angelbroking/historical/v1/getCandleData",
      { exchange, symboltoken: String(symboltoken), interval, fromdate, todate }
    );
    return (data || []).map(row => ({
      time: Math.floor(new Date(row[0]).getTime() / 1000),
      open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
      close: Number(row[4]), volume: Number(row[5] || 0)
    })).filter(x => Number.isFinite(x.time) && Number.isFinite(x.close));
  }

  async marketQuote(mode, exchangeTokens) {
    return this.request("/rest/secure/angelbroking/market/v1/quote/", {
      mode, exchangeTokens
    });
  }

  async historicalOI({ exchange, symboltoken, interval, fromdate, todate }) {
    return this.request("/rest/secure/angelbroking/historical/v1/getOIData", {
      exchange, symboltoken: String(symboltoken), interval, fromdate, todate
    });
  }

  async optionGreeks(name, expiry) {
    return this.request("/rest/secure/angelbroking/marketData/v1/optionGreek", {
      name, expiry
    });
  }
}

module.exports = { AngelOne };
