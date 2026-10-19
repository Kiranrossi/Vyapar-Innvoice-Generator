# AGAM Billing (Invoice Generator)

A web version of the Vyapar billing app. Make GST sale invoices and download them as PDFs in the same layout Vyapar prints. Customers, items and vehicle numbers you type in are saved and suggested next time. All phones and tablets share the same data.

The live app's web address is printed by `npm run deploy`. A fresh install starts with PIN **2000**; change it straight away in Settings → PIN Lock.

## How it's hosted

Everything runs free on Cloudflare:

- **Cloudflare Workers** runs the API (`worker/src`) and serves the React app (`client/dist`).
- **Cloudflare D1** holds the data (database `agam-billing`). D1 can roll the database back to any point in the last 7 days.
- Each device enters the PIN once and then stays unlocked. Changing the PIN locks every other device.

## Updating the live app

```bash
npm run setup     # first time only: installs everything and makes a local test database
npm run deploy    # builds the app and uploads it to Cloudflare
```

If a new file is added to `worker/migrations`, apply it online first:

```bash
npm run migrate:remote --prefix worker
```

## Working on it locally

```bash
npm run dev       # local Worker (with its own local database) + the app with live reload
```

Open http://localhost:5173 (PIN  on a fresh local database).

## What it does

- **Sale**: pick a customer (or type a new one), add items, and save. Invoice numbers go up by one; if two phones save at the same moment, the second one automatically takes the next number. Each item can have a discount %, and there's round-off. Sales can be edited or deleted.
- **Transportation**: vehicle number (pick a saved one or type a new one) and transporter, printed above Terms and Conditions.
- **GST**: each item has its own rate. Sales in your own state show SGST + CGST; sales to another state show IGST.
- **PDF**: the same layout as Vyapar's Tax Invoice, with amount in words, received/balance, logo, signature, and bank details with a UPI QR code for the balance due. Preview, print, download or send on WhatsApp.
- **Payments**: record money received later against an invoice. Balances and Paid / Partial / Unpaid update automatically.
- **Parties**: customers with balances and their invoices. **Statement** makes a PDF of all their sales and payments for any period.
- **Items**: products with HSN, price, GST and stock. Stock goes down when you sell.
- **GST Report**: monthly summary by GST rate and HSN, with an Excel download for the CA (GSTR-1).
- **Backup**: Settings → Download Backup saves everything as one `.json` file; Restore loads it back. Home reminds you if you haven't downloaded one in a week.

## Code layout

```
shared/   GST maths, amount-in-words, state codes (used by the app and the Worker)
worker/   Cloudflare Worker API (Hono) + D1 schema in migrations/
client/   React + Tailwind app; src/pdf/InvoicePDF.jsx is the invoice template
server/   Old version that ran on one computer (Express + SQLite). No longer used;
          server/data/invoices.db is the data it held before the move to Cloudflare.
```
