import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { findKiroConnectionByIdentity } from "@/lib/oauth/kiroConnectionIdentity";
import {
  createProviderConnection,
  getProviderConnections,
  updateProviderConnection,
} from "@/models";

/**
 * POST /api/oauth/kiro/social-exchange
 * Poll device code for tokens (Google/GitHub social login device flow).
 * Also backward compatible with legacy { code, codeVerifier, provider } PKCE flow.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { deviceCode, code, codeVerifier, provider } = body;

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    let tokenData;

    // Handle modern Device Flow polling
    if (deviceCode) {
      const pollResult = await kiroService.pollSocialDeviceToken(deviceCode);

      if (pollResult.pending) {
        return NextResponse.json({
          success: false,
          pending: true,
          error: pollResult.error,
        });
      }

      if (!pollResult.success) {
        return NextResponse.json(
          {
            success: false,
            pending: false,
            error: pollResult.error,
          },
          { status: pollResult.status || 400 }
        );
      }

      tokenData = pollResult.tokens;
    } else if (code && codeVerifier) {
      // Legacy manual callback PKCE exchange fallback
      tokenData = await kiroService.exchangeSocialCode(code, codeVerifier);
    } else {
      return NextResponse.json(
        { error: "Missing required fields (deviceCode or code + codeVerifier)" },
        { status: 400 }
      );
    }

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    const providerSpecificData = {
      authMethod: provider, // "google" or "github"
      provider: provider.charAt(0).toUpperCase() + provider.slice(1),
    };

    if (tokenData.profileArn) {
      providerSpecificData.profileArn = tokenData.profileArn;
    }

    const connectionData = {
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData,
      testStatus: "active",
      isActive: true,
    };

    // Check existing connections to update only if exact account matches.
    // ProfileArn alone identifies the CodeWhisperer profile, not the account (distinct
    // accounts share the same ARN). Only match if account-level identifiers agree.
    const existing = await getProviderConnections({ provider: "kiro" });
    const match = findKiroConnectionByIdentity(existing, {
      authType: "oauth",
      profileArn: tokenData.profileArn,
      email,
    });

    const connection = match
      ? await updateProviderConnection(match.id, connectionData)
      : await createProviderConnection(connectionData);

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.error("Kiro social exchange error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
