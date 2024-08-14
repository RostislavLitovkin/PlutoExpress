import express from "express";
import { WsProvider, ApiPromise } from "@polkadot/api";
import { TradeRouter, PoolService } from '@galacticcouncil/sdk';
import { HydrationSwapInput } from "./HydrationSwapInput";
import { buildTransferExtrinsics } from "@paraspell/xcm-router";
const app = express();
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

app.get('/xcm', async (req, res) => {
  await connect()

  const address = ""

  const extrinsic = await buildTransferExtrinsics({
    from: 'Polkadot', //Origin Parachain/Relay chain
    to: 'Interlay', //Destination Parachain/Relay chain
    currencyFrom: 'DOT', // Currency to send
    currencyTo: 'INTR', // Currency to receive
    amount: '100000', // Amount to send
    slippagePct: '1', // Max slipppage percentage
    injectorAddress: address, //Injector address
    recipientAddress: address,
  })

  res.send(extrinsic);
});

app.post('/dot-price', async (req, res) => {
  await connect()

  const input = req.body as HydrationSwapInput;
  // Do something
  const result = await tradeRouter.getBestSpotPrice(input.tokenIn, input.tokenOut);    
  res.send(result);
});


app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
