import { Agent } from "@atproto/api";

interface CreateHookRecordArgs {
  nsid: string;
  webhookUrl: string;
}

interface HookRecordValue {
  nsid: string;
  webhookUrl: string;
  createdAt: string;
}

interface ListHookRecord {
  uri: string;
  cid: string;
  value: HookRecordValue;
}

const COLLECTION = "com.communitytap.hook";

export async function createHookRecord(
  agent: Agent,
  did: string,
  args: CreateHookRecordArgs
): Promise<{ uri: string; cid: string }> {
  const record = {
    nsid: args.nsid,
    webhookUrl: args.webhookUrl,
    createdAt: new Date().toISOString(),
  };

  const result = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COLLECTION,
    record,
  });

  return { uri: result.data.uri, cid: result.data.cid };
}

export async function deleteHookRecord(
  agent: Agent,
  uri: string
): Promise<void> {
  const parsed = parseAtUri(uri);
  if (!parsed) {
    throw new Error(`Invalid AT-URI: ${uri}`);
  }

  await agent.com.atproto.repo.deleteRecord({
    repo: parsed.repo,
    collection: parsed.collection,
    rkey: parsed.rkey,
  });
}

export async function listHookRecords(agent: Agent, did: string): Promise<ListHookRecord[]> {
  const result = await agent.com.atproto.repo.listRecords({
    repo: did,
    collection: COLLECTION,
    limit: 100,
  });

  return result.data.records.map((rec) => ({
    uri: rec.uri,
    cid: rec.cid,
    value: rec.value as unknown as HookRecordValue,
  }));
}

interface ParsedAtUri {
  repo: string;
  collection: string;
  rkey: string;
}

function parseAtUri(uri: string): ParsedAtUri | null {
  // AT-URI format: at://did/collection/rkey
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return {
    repo: match[1],
    collection: match[2],
    rkey: match[3],
  };
}
