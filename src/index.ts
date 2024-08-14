import express from "express";
import { WsProvider, ApiPromise } from "@polkadot/api";
import { TradeRouter, PoolService } from '@galacticcouncil/sdk';
import { HydrationSwapInput } from "./HydrationSwapInput";
import { setup } from '@acala-network/chopsticks-core'
import { ChopsticksInput } from "./ChopsticksInput";
// import { IdbDatabase } from '@acala-network/chopsticks-db/browser.js'
const app = express();
// Middleware to parse JSON bodies
app.use(express.json());
const port = 8000;

let tradeRouter: TradeRouter;
const connect = async () => {
  if (tradeRouter != null) {
    return;
  }
  // Initialize Polkadot API
  const wsProvider = new WsProvider('wss://rpc.hydradx.cloud');
  const api = await ApiPromise.create({ provider: wsProvider });

  // Initialize Trade Router
  const poolService = new PoolService(api);

  await poolService.syncRegistry();
  tradeRouter = new TradeRouter(poolService);
}

setInterval(connect, 1000 * 60 * 60 * 24);

app.get('/all-assets', async (req, res) => {
  await connect()

  const result = await tradeRouter.getAllAssets();
  res.send(result);
});

app.post('/dot-price', async (req, res) => {
  await connect()

  const input = req.body as HydrationSwapInput;
  // Do something
  const result = await tradeRouter.getBestSpotPrice(input.tokenIn, input.tokenOut);
  res.send(result);
});

// Chopstics API
app.post('/get-extrinsic-events', async (req, res) => {
  console.log("request-body: ", req.body)
  const input = req.body as ChopsticksInput;
  if (input == null || input == undefined) {
    res.status(400).send("No chopsticks input provided!")
    return
  }

  const chain = await setup({
    endpoint: input.endpoint,
    block: 22090231,
    mockSignatureHost: true,
    db: undefined, //new IdbDatabase('cache'),
  })

  try {
    const { outcome, storageDiff } = await chain.dryRunExtrinsic({
      call: input.extrinsic,
      address: input.address,
    })
    const dryRunResult = JSON.stringify({ outcome: outcome.toHuman(), storageDiff }, null, 2)
    res.send(dryRunResult)
    console.log("Get-extrinsic-events Done! Resulted in: ", dryRunResult)
  } catch (e) {
    res.status(404)
  }
});


app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
