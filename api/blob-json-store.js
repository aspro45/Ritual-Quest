import {
  BlobPreconditionFailedError,
  get,
  put
} from "@vercel/blob";

const WRITE_RETRIES = 5;

export function blobJsonStoreConfigured() {
  const hasReadWriteToken = String(process.env.BLOB_READ_WRITE_TOKEN || "").length > 20;
  const hasOidc = String(process.env.VERCEL_OIDC_TOKEN || "").length > 20
    && String(process.env.BLOB_STORE_ID || "").length > 5;
  return hasReadWriteToken || hasOidc;
}

function blobOptions() {
  return {
    access: "private",
    useCache: false
  };
}

function isWriteConflict(error) {
  if (error instanceof BlobPreconditionFailedError) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /already exists|conflict|precondition|status\s*409/i.test(message);
}

async function readSnapshot(pathname) {
  const result = await get(pathname, blobOptions());
  if (!result) return { records: [], etag: "" };
  if (result.statusCode !== 200 || !result.stream) throw new Error("Shared content store returned an invalid response.");

  const raw = await new Response(result.stream).text();
  const records = JSON.parse(raw || "[]");
  if (!Array.isArray(records)) throw new Error("Shared content store is not a JSON collection.");
  return { records, etag: result.blob.etag };
}

export async function readBlobJsonRecords(pathname) {
  return (await readSnapshot(pathname)).records;
}

export async function mutateBlobJsonRecords(pathname, mutate) {
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    const snapshot = await readSnapshot(pathname);
    const nextRecords = mutate(structuredClone(snapshot.records));
    if (!Array.isArray(nextRecords)) throw new Error("Shared content update must return a JSON collection.");

    try {
      await put(pathname, `${JSON.stringify(nextRecords, null, 2)}\n`, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(snapshot.etag),
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(snapshot.etag ? { ifMatch: snapshot.etag } : {})
      });
      return nextRecords;
    } catch (error) {
      if (!isWriteConflict(error) || attempt === WRITE_RETRIES - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 35 * (attempt + 1)));
    }
  }

  throw new Error("Shared content changed too quickly. Please retry.");
}
