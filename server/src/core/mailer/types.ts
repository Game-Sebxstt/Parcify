export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  readonly driver: 'smtp' | 'resend' | 'console' | 'memory';
  send(message: MailMessage): Promise<void>;
  close?(): Promise<void>;
}

export interface StoredMail extends MailMessage {
  sentAt: Date;
}
