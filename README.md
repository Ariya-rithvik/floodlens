# FloodLens

**Know what changed. Know what is verified. Carry it out when the network is gone.**

FloodLens is an offline-first road-condition evidence system for floods and landslides. A resident records what they see on a road; the report is kept on the phone, handed phone-to-phone by QR code with no network, and delivered to a response desk on AWS by whichever device reaches the internet first.

Track: **Heat and Water** · WeMakeDevs × AWS Environmental Hacks 2026

**Live on AWS:** https://d24y0wbvz1jjie.cloudfront.net (add `?demo` for the rehearsal controls: a simulated drill and a network-cut switch)

**Demo video (2 min):** [docs/floodlens-demo.mp4](docs/floodlens-demo.mp4), recorded against the live deployment. Screenshots are in [docs/screens](docs/screens).

## What works today

| | |
|---|---|
| Offline map | Real OpenStreetMap roads, bridges, rivers and villages for Meppadi–Chooralmala, Wayanad, bundled in the app. No map tiles, nothing to download in the field. |
| Offline reporting | Hazard type, location snapped to the nearest road, optional photo. Saved to IndexedDB. The app says "saved, not delivered" until it truly is delivered. |
| Offline handoff | A report becomes a ~110-character QR code. Another phone scans it and becomes its carrier. Scanning twice never duplicates. |
| Delivery | The first device online pushes to the AWS API. The same report arriving by two routes is stored once, with both routes recorded. |
| Evidence rules | Reported → corroborated (two independent devices) → verified by a responder. Hazard + "passable" at once is flagged as a conflict, never averaged. |
| Expiry | Every observation has a lifetime. Expired evidence turns the road *stale*, never *safe*. The time lens shows what will still be known in N hours if nobody checks. |
| Alert network | People opt in with a phone number and home place. When two independent phones confirm a hazard, responders and members within 3 km get an automated voice call through CALL-E. One round of calls per road. Numbers never leave the backend. |
| Response desk | Inspection queue ordered by urgency, with corroboration rate, stale count and median seen-to-delivered time. |

Tested and not tested: the flow above was exercised in a desktop browser against the live deployment, and one real CALL-E call was placed to a consenting number from the local backend. Camera QR scanning and photo capture have not been verified on physical phones in this repo's history.

Not built: Wi-Fi Direct and LoRa transfer, Cognito accounts (a shared responder key stands in), routing, leaving the alert network from inside the app. FloodLens does not predict safe roads and makes no claim about saving lives.

## Run it locally

```bash
node backend/local.mjs
```

```bash
npm --prefix web install
```

```bash
npm --prefix web run dev
```

Open `http://localhost:5173`. A second, separate device: `http://localhost:5173/?device=B`. Local responder key: `drill-2026`.

Tests: `npm --prefix web test` (evidence rules, QR format), `node backend/test-alerts.mjs` (who gets called), `node backend/test-calle.mjs` (call request and guards; places no call).

Real phones on the same Wi-Fi: `npm --prefix web run dev:phones`, then open the printed `https://<laptop-ip>:5443` address.

## Deploy to AWS

Needs the AWS CLI and SAM CLI, with credentials configured.

```bash
npm --prefix web run build
```

```bash
sam deploy --guided --template-file backend/template.yaml --stack-name floodlens --capabilities CAPABILITY_IAM
```

Then upload the app to the `SiteBucket` output and open the `AppUrl` output:

```bash
aws s3 sync web/dist s3://SITE_BUCKET --delete
```

## How AWS is used

- **CloudFront + S3**: serves the PWA over HTTPS (required for camera and service worker) and the photo evidence.
- **API Gateway (HTTP API) + Lambda**: `/api/sync` ingests batches, `/api/reports` returns the shared picture.
- **DynamoDB**: one item per report ID, written with a conditional put so concurrent carriers cannot create duplicates.
- **Amazon Bedrock** (optional, `BedrockModelId` parameter): one-sentence read of each photo to help a reviewer. It never sets a road status.
- **SAM**: the whole stack is `backend/template.yaml`.

Voice calls use the CALL-E Developer API, triggered from Lambda (`backend/src/calle.mjs`). They are off unless the `CalleApiKey` deploy parameter is set, and `CalleAllowedNumbers` restricts dialling to a fixed list.

## Layout

- `web/src/lib/status.js`: the evidence rules (pure, tested)
- `web/src/lib/codec.js`: QR payload format
- `web/src/lib/sync.js`, `db.js`: outbox and on-device storage
- `backend/src/core.mjs`: ingest logic shared by Lambda (`aws.mjs`) and the local server (`local.mjs`)
- `scripts/`: rebuild the offline pack from OpenStreetMap
- `tools/record-demo.mjs`: regenerates the demo video by driving the real app

Map data © OpenStreetMap contributors, ODbL. The "simulated drill" loads invented observations on real roads and labels them as simulated everywhere.
