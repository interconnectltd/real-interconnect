import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("user_profiles").select("id").limit(1);

    if (error) {
      return NextResponse.json(
        { status: "unhealthy", error: error.message },
        { status: 503 },
      );
    }

    return NextResponse.json({ status: "healthy", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "unhealthy" }, { status: 503 });
  }
}
