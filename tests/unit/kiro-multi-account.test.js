import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findKiroConnectionByIdentity } from "../../src/lib/oauth/kiroConnectionIdentity.js";
import {
  createProviderConnection,
  getProviderConnections,
  deleteProviderConnectionsByProvider,
} from "../../src/models/index.js";

describe("findKiroConnectionByIdentity helper", () => {
  const existingConnections = [
    {
      id: "conn-1",
      provider: "kiro",
      authType: "oauth",
      email: "user1@github.com",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
        authMethod: "github",
      },
    },
    {
      id: "conn-2",
      provider: "kiro",
      authType: "oauth",
      email: "user2@github.com",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
        authMethod: "github",
      },
    },
    {
      id: "conn-idc",
      provider: "kiro",
      authType: "oauth",
      email: "corp@company.com",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/corp",
        clientId: "client-idc-123",
        authMethod: "idc",
      },
    },
  ];

  it("does NOT match if email contradicts, even when profileArn is identical", () => {
    const match = findKiroConnectionByIdentity(existingConnections, {
      authType: "oauth",
      profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
      email: "user3@github.com",
    });
    expect(match).toBeNull();
  });

  it("does NOT match if incoming identity has profileArn but no account identifier", () => {
    const match = findKiroConnectionByIdentity(existingConnections, {
      authType: "oauth",
      profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
      email: null,
    });
    expect(match).toBeNull();
  });

  it("matches if email is the same and profileArn is identical (re-authorization)", () => {
    const match = findKiroConnectionByIdentity(existingConnections, {
      authType: "oauth",
      profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
      email: "user1@github.com",
    });
    expect(match).not.toBeNull();
    expect(match.id).toBe("conn-1");
  });

  it("matches by clientId for IDC connections", () => {
    const match = findKiroConnectionByIdentity(existingConnections, {
      authType: "oauth",
      clientId: "client-idc-123",
    });
    expect(match).not.toBeNull();
    expect(match.id).toBe("conn-idc");
  });

  it("returns null for non-matching input", () => {
    const match = findKiroConnectionByIdentity(existingConnections, {
      authType: "oauth",
      email: "unknown@example.com",
    });
    expect(match).toBeNull();
  });
});

describe("Kiro multi-account connection storage in database", () => {
  beforeEach(async () => {
    await deleteProviderConnectionsByProvider("kiro");
  });

  afterEach(async () => {
    await deleteProviderConnectionsByProvider("kiro");
  });

  it("creates two separate Kiro connections when two accounts have different emails with same generic profileArn", async () => {
    const conn1 = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "account1@example.com",
      accessToken: "token-1",
      refreshToken: "refresh-1",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
        authMethod: "github",
      },
    });

    const conn2 = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "account2@example.com",
      accessToken: "token-2",
      refreshToken: "refresh-2",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1::profile/shared-default",
        authMethod: "github",
      },
    });

    expect(conn2.id).not.toBe(conn1.id);

    const all = await getProviderConnections({ provider: "kiro" });
    expect(all.length).toBe(2);
    expect(all.map((c) => c.email)).toContain("account1@example.com");
    expect(all.map((c) => c.email)).toContain("account2@example.com");
  });

  it("keeps two Kiro connections with same email separate if they have different profileArn", async () => {
    const conn1 = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "token-profile-1",
      refreshToken: "refresh-profile-1",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:1111:profile/profileA",
        authMethod: "imported",
      },
    });

    const conn2 = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "user@example.com",
      accessToken: "token-profile-2",
      refreshToken: "refresh-profile-2",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:2222:profile/profileB",
        authMethod: "imported",
      },
    });

    expect(conn2.id).not.toBe(conn1.id);
    const all = await getProviderConnections({ provider: "kiro" });
    expect(all.length).toBe(2);
  });

  it("updates existing connection in place on re-authorization of the same account", async () => {
    const conn1 = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "same@example.com",
      accessToken: "token-orig",
      refreshToken: "refresh-orig",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:3333:profile/profileC",
        authMethod: "github",
      },
    });

    const connReauth = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "same@example.com",
      accessToken: "token-updated",
      refreshToken: "refresh-updated",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:3333:profile/profileC",
        authMethod: "github",
      },
    });

    expect(connReauth.id).toBe(conn1.id);
    const all = await getProviderConnections({ provider: "kiro" });
    expect(all.length).toBe(1);
    expect(all[0].accessToken).toBe("token-updated");
  });
});
