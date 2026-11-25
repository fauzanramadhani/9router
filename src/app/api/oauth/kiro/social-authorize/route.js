import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";

/**
 * GET /api/oauth/kiro/social-authorize
 * Initiate Google/GitHub social login via Kiro desktop device flow.
 * Returns verification URL & userCode for the user to authenticate in browser.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider"); // "google" or "github"

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    const authData = await kiroService.startSocialDeviceAuthorization(provider);

    return NextResponse.json(authData);
  } catch (error) {
    console.error("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
