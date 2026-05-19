import "server-only";

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const TTL_GET = 60 * 15; // 15 minutes — bounds how long a tab can sit on a stale URL
const TTL_PUT = 60 * 5; // 5 minutes — uploads happen immediately after the mint

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint =
    process.env.R2_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "R2 misconfigured: R2_ACCOUNT_ID/R2_ENDPOINT + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY are required",
    );
  }
  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 rejects CRC32 checksums sent by default from AWS SDK ≥ 3.729; a
    // server-side mitigation shipped Feb 2026 but explicit config is safer.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

export function bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET env var is required");
  return b;
}

/** Key shape for a stored design. */
export function designKey(id: string): string {
  return `designs/${id}.glb`;
}

export async function presignedGetUrl(key: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: TTL_GET },
  );
}

/**
 * Presigned PUT URL. Critically does NOT include Content-Type in the signed
 * headers — XHR/fetch in the browser will set its own Content-Type slightly
 * differently than the SDK assumes, which trips silent SignatureDoesNotMatch
 * 403s. We accept whatever the browser sends.
 */
export async function presignedPutUrl(key: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: TTL_PUT, unhoistableHeaders: new Set(["content-type"]) },
  );
}

/** Upload bytes server-side. Used by the "fork template" path on design creation. */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType = "model/gltf-binary",
): Promise<{ etag: string | undefined; size: number }> {
  const out = await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { etag: out.ETag, size: body.byteLength };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

/** Readiness probe: HEAD a known sentinel key. Class B op (~$0.36/M). */
export async function readinessHeadObject(): Promise<void> {
  await getClient().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: ".healthcheck" }),
  );
}
