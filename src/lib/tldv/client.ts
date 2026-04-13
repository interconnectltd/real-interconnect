const TLDV_BASE_URL = "https://pasta.tldv.io/v1alpha1";

export interface TldvMeetingSummary {
  id: string;
  name: string;
  happenedAt: string;
  url: string;
  duration: number;
  organizer: { name: string; email: string };
  invitees: { name: string; email: string }[];
}

export interface TldvMeetingListResponse {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  results: TldvMeetingSummary[];
}

export interface TldvTranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface TldvTranscriptResponse {
  id: string;
  meetingId: string;
  data: TldvTranscriptSegment[];
}

export class TldvApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`tl;dv API error (${status}): ${message}`);
    this.name = "TldvApiError";
  }
}

export class TldvClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${TLDV_BASE_URL}${path}`, {
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new TldvApiError(res.status, body);
    }

    return res.json() as Promise<T>;
  }

  async listMeetings(page = 1): Promise<TldvMeetingListResponse> {
    return this.request(`/meetings?page=${page}`);
  }

  async getMeeting(id: string): Promise<TldvMeetingSummary> {
    return this.request(`/meetings/${encodeURIComponent(id)}`);
  }

  async getTranscript(meetingId: string): Promise<TldvTranscriptResponse> {
    return this.request(
      `/meetings/${encodeURIComponent(meetingId)}/transcript`,
    );
  }
}

export function createTldvClient(): TldvClient {
  const apiKey = process.env.TLDV_API_KEY;
  if (!apiKey) {
    throw new Error("TLDV_API_KEY is not set");
  }
  return new TldvClient(apiKey);
}
