export interface RecordedAction {
  timestamp: number;
  type: 'click' | 'change' | 'input' | 'keypress';
  pageUrl: string;
  element: {
    tag: string;
    text: string;
    id: string;
    name: string;
    role: string;
    ariaLabel: string;
    ariaRef?: string;
    context: string;
  };
  value?: string;  // input/change イベント時の入力値（最大500文字）
}

export interface RecordedRequest {
  timestamp: number;
  method: string;
  url: string;
  requestBody?: string;
  contentType?: string;
  responseStatus?: number;
  responseContentType?: string;
  responseSummary?: string;
  authInfo?: {
    type: 'bearer' | 'cookie' | 'basic' | 'csrf' | 'none';
    csrfTokenSource?: string;
  };
}

export interface RecordingData {
  startTime: number;
  endTime: number;
  startUrl: string;
  actions: RecordedAction[];
  requests: RecordedRequest[];
  snapshots: Array<{
    timestamp: number;
    actionIndex: number;
    pageUrl: string;
    content: string;
  }>;
}

export interface PlaywrightStorageState {
  cookies: Array<{
    name: string; value: string; domain: string; path: string;
    expires: number; httpOnly: boolean; secure: boolean; sameSite: string;
    partitionKey?: string;
    _crHasCrossSiteAncestor?: boolean;
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}
