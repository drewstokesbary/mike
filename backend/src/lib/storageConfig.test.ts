import { describe, expect, it } from "vitest";
import { resolveStorageConfig } from "./storage";

describe("resolveStorageConfig", () => {
  it("uses provider-neutral storage variables", () => {
    expect(resolveStorageConfig({
      STORAGE_ENDPOINT_URL: "https://project.storage.supabase.co/storage/v1/s3",
      STORAGE_ACCESS_KEY_ID: "access",
      STORAGE_SECRET_ACCESS_KEY: "secret",
      STORAGE_BUCKET_NAME: "mike",
      STORAGE_REGION: "us-west-1",
    })).toEqual({
      endpoint: "https://project.storage.supabase.co/storage/v1/s3",
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "mike",
      region: "us-west-1",
    });
  });

  it("keeps legacy R2 configuration compatible", () => {
    expect(resolveStorageConfig({
      R2_ENDPOINT_URL: "https://account.r2.cloudflarestorage.com",
      R2_ACCESS_KEY_ID: "old-access",
      R2_SECRET_ACCESS_KEY: "old-secret",
    })).toMatchObject({
      accessKeyId: "old-access",
      secretAccessKey: "old-secret",
      bucket: "mike",
      region: "auto",
    });
  });

  it("prefers provider-neutral values during a staged cutover", () => {
    expect(resolveStorageConfig({
      STORAGE_ENDPOINT_URL: "https://new.example",
      STORAGE_ACCESS_KEY_ID: "new-access",
      STORAGE_SECRET_ACCESS_KEY: "new-secret",
      R2_ENDPOINT_URL: "https://old.example",
      R2_ACCESS_KEY_ID: "old-access",
      R2_SECRET_ACCESS_KEY: "old-secret",
    })?.endpoint).toBe("https://new.example");
  });

  it("stays disabled when credentials are incomplete", () => {
    expect(resolveStorageConfig({ STORAGE_ENDPOINT_URL: "https://example" })).toBeNull();
  });
});
