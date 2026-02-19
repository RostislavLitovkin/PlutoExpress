import { ApiPromise, Keyring, WsProvider } from "@polkadot/api"
import { Router } from "express"

interface BalanceLine {
  label: string
  value?: string
  error?: string
}

interface RenderData {
  faucetAddress: string
  endpoint: string
  chain?: string
  status: string
  balances: BalanceLine[]
}

const faucetPageRouter = Router()

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function getFaucetAddress(): string {
  const phrase = process.env.RICHMAN_PHRASE
  if (!phrase) {
    throw new Error("No faucet phrase configured")
  }
  const keyring = new Keyring({ type: "sr25519" })
  return keyring.addFromUri(phrase).address
}

function normalizeEndpoint(raw: string): string {
  let value = raw.trim()
  try {
    value = decodeURIComponent(value)
  } catch {
    // ignore decode errors and keep raw
  }

  if (!value.startsWith("ws://") && !value.startsWith("wss://")) {
    throw new Error("Endpoint must start with ws:// or wss://")
  }

  return value
}

function formatBalance(api: ApiPromise, value: unknown): string {
  try {
    return api.createType("Balance", value).toHuman()
  } catch (err) {
    try {
      return String(value)
    } catch (e) {
      return "N/A"
    }
  }
}

function normalizeSymbol(symbol?: string) {
  if (!symbol) return undefined
  // Strip leading lowercase "m" often used for milli-units (e.g., mXCAV -> XCAV)
  if (symbol.length > 2 && symbol.startsWith("m") && symbol[1] === symbol[1].toUpperCase()) {
    return symbol.slice(1)
  }
  return symbol
}

function formatAmount(api: ApiPromise, value: unknown, decimals: number | undefined, symbol?: string) {
  try {
    const bn = api.createType("Balance", value).toBigInt()
    const d = Math.max(0, decimals ?? 0)
    if (d === 0) return `${bn.toString()} ${symbol ?? ""}`.trim()

    const base = BigInt(10) ** BigInt(d)
    const whole = bn / base
    const frac = bn % base
    const fracStrFull = frac.toString().padStart(d, "0")
    const fracStr = fracStrFull.slice(0, Math.min(6, d)).replace(/0+$/, "")
    const joined = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString()
    return symbol ? `${joined} ${symbol}` : joined
  } catch (err) {
    return formatBalance(api, value)
  }
}

async function readAssetMetadata(api: ApiPromise, assetId: number) {
  if (!api.query.assets?.metadata) return undefined
  try {
    const meta = await api.query.assets.metadata(assetId)
    const raw = (meta as any)?.isSome ? (meta as any).unwrapOrDefault() : meta
    const symbolValue = (raw as any)?.symbol
    const decimalsValue = (raw as any)?.decimals
    const symbol = typeof symbolValue?.toHuman === "function"
      ? symbolValue.toHuman()
      : symbolValue?.toString?.()
    const decimals = typeof decimalsValue?.toNumber === "function"
      ? decimalsValue.toNumber()
      : typeof decimalsValue === "number"
        ? decimalsValue
        : undefined
    return { symbol: symbol ? String(symbol).trim() : undefined, decimals }
  } catch {
    return undefined
  }
}

async function fetchBalances(endpoint: string, faucetAddress: string) {
  const provider = new WsProvider(endpoint, undefined, undefined, 32 * 1024 * 1024)
  const api = await ApiPromise.create({ provider })

  try {
    const chain = (await api.rpc.system.chain()).toString()
    const chainTokenRaw = api.registry.chainTokens?.[0] ?? "Native"
    const chainToken = normalizeSymbol(chainTokenRaw) ?? chainTokenRaw
    const chainDecimals = api.registry.chainDecimals?.[0] ?? 12
    const account = await api.query.system.account(faucetAddress)

    const balances: BalanceLine[] = [
      {
        label: `${chainToken} (native)`,
        value: formatAmount(api, account.data.free, chainDecimals, chainToken),
      },
    ]

    if (api.query.assets?.account) {
      const assetIds = [1984, 1337]
      for (const assetId of assetIds) {
        try {
          const meta = await readAssetMetadata(api, assetId)
          const symbol = normalizeSymbol(meta?.symbol) ?? meta?.symbol
          const label = symbol ? `${symbol} (Asset ${assetId})` : `Asset ${assetId}`
          const assetAccount = await api.query.assets.account(assetId, faucetAddress)
          if (assetAccount && "isSome" in assetAccount) {
            const data = assetAccount.unwrapOrDefault() as unknown as { balance?: unknown }
            balances.push({
              label,
              value: formatAmount(api, data.balance ?? 0, meta?.decimals ?? 12, symbol ?? `Asset ${assetId}`),
            })
          } else {
            balances.push({ label, value: `0 ${symbol ?? ""}`.trim() })
          }
        } catch (err) {
          balances.push({ label: `Asset ${assetId}`, error: "Assets pallet not available" })
        }
      }
    } else {
      balances.push({ label: "Assets", error: "Assets pallet is not available on this chain" })
    }

    return { chain, balances }
  } finally {
    await api.disconnect().catch(() => undefined)
  }
}

function renderPage(data: RenderData) {
  const { faucetAddress, endpoint, chain, status, balances } = data
  const balancesMarkup = balances.length
    ? balances
        .map((balance) => {
          const value = balance.error ? `<span class="error">${escapeHtml(balance.error)}</span>` : escapeHtml(balance.value ?? "0")
          return `<li><span>${escapeHtml(balance.label)}</span><strong>${value}</strong></li>`
        })
        .join("")
    : ""

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Faucet Balance</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b0b0b;
      --card: #0f0f0f;
      --text: #f5f5f5;
      --muted: #a0a0a0;
      --accent: #ffffff;
      --border: #1c1c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Space Grotesk", "Segoe UI", system-ui, -apple-system, sans-serif;
      color: var(--text);
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    main {
      width: min(720px, 100%);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px 22px 18px;
      box-shadow: none;
    }
    header h1 { margin: 6px 0 4px; font-size: 28px; letter-spacing: -0.02em; }
    header p { margin: 0; color: var(--muted); }
    .eyebrow { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text); margin: 0; }
    form { display: flex; gap: 10px; margin: 16px 0; }
    label { display: block; font-size: 14px; color: var(--muted); margin-bottom: 6px; }
    input[type="text"] {
      flex: 1;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #111;
      color: var(--text);
      outline: none;
      transition: border 0.18s ease;
    }
    input[type="text"]:focus { border-color: #2a2a2a; }
    button {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 16px;
      background: #161616;
      color: var(--text);
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.12s ease, border 0.12s ease;
    }
    button:hover { transform: translateY(-1px); border-color: #2a2a2a; }
    button:active { transform: translateY(0); }
    .address {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px;
      border-radius: 12px;
      border: 1px dashed var(--border);
      background: #121212;
    }
    .address-value { font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; word-break: break-all; }
    .status { margin-top: 8px; color: var(--muted); }
    ul { list-style: none; padding: 0; margin: 14px 0 0; display: flex; flex-direction: column; gap: 10px; }
    li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #111;
    }
    li strong { font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .error { color: #ffffff; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: #111; color: var(--text); font-size: 13px; border: 1px solid var(--border); }
    .muted { color: var(--muted); }
    .stack { display: flex; flex-direction: column; gap: 2px; }
    .toast { position: fixed; bottom: 24px; right: 24px; padding: 10px 12px; border-radius: 10px; background: #111; color: var(--text); border: 1px solid var(--border); opacity: 0; transform: translateY(10px); transition: opacity 0.15s ease, transform 0.15s ease; }
    .toast.show { opacity: 1; transform: translateY(0); }
    @media (max-width: 640px) {
      form { flex-direction: column; }
      button { width: 100%; }
      main { padding: 18px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Faucet</p>
      <h1>Balance Monitor</h1>
      <p>Inspect the faucet wallet on any endpoint that exposes the chain via WebSocket.</p>
    </header>
    <section>
      <label for="endpoint-input">WebSocket endpoint</label>
      <form id="endpoint-form">
        <input id="endpoint-input" type="text" name="endpoint" placeholder="wss://rpc.example.com" value="${escapeHtml(endpoint)}" />
        <button type="submit">Load balances</button>
      </form>
      ${chain ? `<span class="badge">${escapeHtml(chain)}</span>` : ""}
      <p class="status">${escapeHtml(status)}</p>
    </section>

    <section class="stack" style="margin-top:14px;">
      <span class="muted">Faucet address</span>
      <div class="address">
        <div class="address-value" id="address-value">${escapeHtml(faucetAddress)}</div>
        <button type="button" id="copy-btn">Copy</button>
      </div>
    </section>

    <section style="margin-top:16px;">
      <span class="muted">Balances</span>
      ${balancesMarkup ? `<ul>${balancesMarkup}</ul>` : '<p class="muted">Enter an endpoint and submit to query balances.</p>'}
    </section>
  </main>
  <div class="toast" id="toast">Copied address</div>
  <script>
    (function() {
      const form = document.getElementById('endpoint-form');
      const input = document.getElementById('endpoint-input');
      const copyBtn = document.getElementById('copy-btn');
      const toast = document.getElementById('toast');
      form?.addEventListener('submit', function(event) {
        event.preventDefault();
        const next = new URL(window.location.href);
        const value = (input?.value || '').trim();
        if (value) {
          next.searchParams.set('endpoint', value);
        } else {
          next.searchParams.delete('endpoint');
        }
        window.location.href = next.toString();
      });
      copyBtn?.addEventListener('click', async function() {
        try {
          await navigator.clipboard.writeText('${escapeHtml(faucetAddress)}');
          if (toast) {
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 1400);
          }
        } catch (err) {
          if (toast) {
            toast.textContent = 'Copy failed';
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 1400);
          }
        }
      });
    })();
  </script>
</body>
</html>`
}

faucetPageRouter.get("/faucet", async (req, res) => {
  let faucetAddress: string
  try {
    faucetAddress = getFaucetAddress()
  } catch (err) {
    res.status(501).send("Faucet phrase is not configured on the server.")
    return
  }

  const endpointParam = typeof req.query.endpoint === "string" ? req.query.endpoint : ""

  if (!endpointParam) {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.send(
      renderPage({
        faucetAddress,
        endpoint: "",
        status: "Provide an endpoint via ?endpoint=wss://... to query balances.",
        balances: [],
      })
    )
    return
  }

  try {
    const endpoint = normalizeEndpoint(endpointParam)
    const { chain, balances } = await fetchBalances(endpoint, faucetAddress)
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.send(
      renderPage({
        faucetAddress,
        endpoint,
        chain,
        status: `Connected to ${chain}`,
        balances,
      })
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to read balances"
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.status(502).send(
      renderPage({
        faucetAddress,
        endpoint: endpointParam,
        status: `Could not load balances: ${message}`,
        balances: [],
      })
    )
  }
})

export default faucetPageRouter
