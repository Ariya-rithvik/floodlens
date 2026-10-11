// Removes what a recording run left on the deployed backend: reports made or carried by the recording's devices,
// and the fictional example member. Reports from anyone else are left alone.
// Run: node tools/clean-recording.mjs <deviceId> [deviceId...]
import { execFileSync } from 'node:child_process';

const devices = new Set(process.argv.slice(2));
if (!devices.size) throw new Error('pass the device ids printed by record-demo.mjs');
const aws = (...args) => execFileSync('aws', [...args, '--region', 'ap-south-1', '--output', 'json'], { encoding: 'utf8' });

const table = JSON.parse(aws('cloudformation', 'describe-stack-resource', '--stack-name', 'floodlens', '--logical-resource-id', 'Reports')).StackResourceDetail.PhysicalResourceId;
const items = JSON.parse(aws('dynamodb', 'scan', '--table-name', table)).Items;
let removed = 0, kept = 0;
for (const item of items) {
  const id = item.report_id.S;
  const carriers = (item.hops?.L || []).map((h) => h.M.device?.S);
  const mine = id === 'MEMBER#+910000000000' || devices.has(item.origin_device?.S) || carriers.some((d) => devices.has(d));
  if (!mine) { kept++; continue; }
  aws('dynamodb', 'delete-item', '--table-name', table, '--key', JSON.stringify({ report_id: { S: id } }));
  removed++;
}
console.log({ removed, kept });
