export type MessageStatus = 'pending' | 'sending' | 'delivered' | 'failed';

export interface Message {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: MessageStatus;
  createdAt: number;
}
