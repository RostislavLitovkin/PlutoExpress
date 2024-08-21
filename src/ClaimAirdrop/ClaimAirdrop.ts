import { Request, Response } from 'express';
import path from 'path';
import * as core from "express-serve-static-core";

export function claimAirdrop(app: core.Express) {
    app.post('/claim-airdrop', (req: Request, res: Response) => {
        const { symbol } = req.body;

        if (!symbol || typeof symbol !== 'string') {
            return res.status(400).json({ error: 'Invalid or missing "symbol" parameter' });
        }

        // Specify the file path
        const filePath = path.join(__dirname, `${symbol}.csv`);

        // Send the file to the client
        res.download(filePath, 'symbol.csv', (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).send('Error generating CSV file');
            }
        });
    });
}