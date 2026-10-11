// Lambda entry point: the same core logic as local.mjs, backed by DynamoDB (reports), S3 (photo evidence)
// and, when BEDROCK_MODEL_ID is set, Amazon Bedrock for a first read of each photo.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { makeApi } from './core.mjs';
import { makeCaller } from './calle.mjs';

const { TABLE, BUCKET, RESPONDER_KEY, BEDROCK_MODEL_ID, CALLE_API_KEY, CALLE_ALLOWED_NUMBERS } = process.env;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const bedrock = BEDROCK_MODEL_ID ? new BedrockRuntimeClient({}) : null;
const jpegBytes = (dataUrl) => Buffer.from(dataUrl.split(',')[1], 'base64');

const store = {
  get: async (id) => (await ddb.send(new GetCommand({ TableName: TABLE, Key: { report_id: id } }))).Item,
  put: async (item) => {
    try {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: 'attribute_not_exists(report_id)' }));
      return true;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  },
  update: async (id, patch) => {
    const keys = Object.keys(patch);
    await ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { report_id: id },
      UpdateExpression: 'SET ' + keys.map((k, i) => `#k${i} = :v${i}`).join(', '),
      ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, patch[k]])),
    }));
  },
  // A hackathon-sized table: a scan is fine. A real deployment would query by area and time.
  list: async () => {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
      items.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  },
};

const photos = {
  put: async (id, dataUrl) => {
    const Key = `evidence/${id}.jpg`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: jpegBytes(dataUrl), ContentType: 'image/jpeg' }));
    return `/${Key}`; // served through the same CloudFront distribution as the app
  },
};

// The model describes what is visible. It never sets a road status: people and the evidence rules do that.
async function classify(report) {
  if (!bedrock) return null;
  const out = await bedrock.send(new ConverseCommand({
    modelId: BEDROCK_MODEL_ID,
    inferenceConfig: { maxTokens: 120, temperature: 0 },
    messages: [{
      role: 'user',
      content: [
        { image: { format: 'jpeg', source: { bytes: jpegBytes(report.photo) } } },
        { text: `A resident reported "${report.kind.replace(/_/g, ' ')}" on a road. In one sentence under 30 words, say what is visible in the photo and whether it is consistent with that report. Do not estimate water depth. Do not say whether the road is safe.` },
      ],
    }],
  }));
  const summary = out.output?.message?.content?.[0]?.text?.trim();
  return summary ? { summary, model: BEDROCK_MODEL_ID } : null;
}

// Without a CALL-E key the alert network still records who would be called, marked as not placed.
const notify = makeCaller({ apiKey: CALLE_API_KEY, allowed: CALLE_ALLOWED_NUMBERS }) || (async () => ({ status: 'simulated' }));
const api = makeApi({ store, photos, classify, notify, responderKey: RESPONDER_KEY });

export const handler = (event) => api({
  method: event.requestContext.http.method,
  path: event.rawPath.replace(/^\/api/, ''),
  headers: event.headers,
  body: event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body,
});
