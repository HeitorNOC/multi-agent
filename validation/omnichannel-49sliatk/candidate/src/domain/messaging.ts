type Channel = 'whatsapp' | 'webchat';
type Context = {
  tenantId: string;
  principalId: string;
  correlationId: string;
  scopes: readonly string[];
};
type Inbound = {
  integrationId: string;
  channel: Channel;
  externalSessionId: string;
  eventId: string;
  text: string;
};
type Receipt = { status: 'accepted'; providerId: string } | { status: 'unknown' | 'rejected' };
type Dispatch = {
  id: string;
  tenantId: string;
  integrationId: string;
  channel: Channel;
  externalSessionId: string;
  correlationId: string;
  text: string;
};
type DeliveryStatus = 'queued' | 'in_flight' | Receipt['status'];
type HistoryItem = {
  cursor: string;
  direction: 'in' | 'out';
  text: string;
  correlationId: string;
  deliveryStatus: DeliveryStatus | 'untracked' | null;
  providerMessageId: string | null;
};
type RecoveryItem = Pick<Dispatch, 'id' | 'correlationId'> & {
  status: 'in_flight' | 'unknown';
  claimedAt: Date;
};
type RecoveryReceipt = Extract<Receipt, { status: 'accepted' }> | { status: 'rejected' };
type Intake = { sessionId: string; dispatchId: string; duplicate: boolean };
type Outcome<T> = { ok: true; data: T } | { ok: false; code: 1; message: string };

interface MessagingStore {
  ingest(context: Context, input: Inbound, reply: string): Promise<Intake | 'conflict' | 'forbidden'>;
  claim(context: Context, id: string): Promise<Dispatch | undefined>;
  settle(context: Context, id: string, receipt: Receipt): Promise<boolean>;
  history(context: Context, sessionId: string, cursor: string, limit: number): Promise<HistoryItem[]>;
  recoverable(context: Context): Promise<RecoveryItem[]>;
  reconcile(context: Context, id: string, evidence: string, receipt: RecoveryReceipt): Promise<boolean>;
}

interface TestChannel {
  send(dispatch: Dispatch): Promise<Receipt>;
}

export type { Context, Inbound, Receipt, Dispatch, HistoryItem, Intake, Outcome, MessagingStore,
  TestChannel, RecoveryItem, RecoveryReceipt };
