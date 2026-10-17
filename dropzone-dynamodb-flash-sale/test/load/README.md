# test/load

k6 scripts. `drop.js` is the headline experiment: 500 units of one SKU, 0 to 2,000 virtual users
over 30 s, each creating a hold and confirming it.

Run A uses `stockBuckets = 1`, run B uses `stockBuckets = 10`, same seed and same script. Raise
the commerce table's warm throughput before both, so the comparison isolates the hot key rather
than cold capacity, and keep API Gateway stage throttling and reserved concurrency on
`create-hold` and `confirm-hold` in place to protect the rest of the system.

Record the results table from spec section 9, and run `scripts/verify-stock.ts` afterwards.
