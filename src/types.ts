export type EncryptedAttachment = {
  url?: string;
  v: string;
  key: JsonWebKey & {
    alg: string;
    key_ops: string[];
    kty: string;
    k: string;
    ext: boolean;
  };
  iv: string;
  hashes: { sha256: string };
};
export type Message = {
  id: string;
  sender: string;
  name: string;
  text: string;
  time: number;
  own?: boolean;
  kind?: "text" | "image" | "file";
  url?: string;
  pending?: boolean;
  failed?: boolean;
  encrypted?: boolean;
  reply?: string;
  replyId?: string;
  edited?: boolean;
  redacted?: boolean;
  filename?: string;
  mimetype?: string;
  size?: number;
  localFile?: string;
  mediaUri?: string;
  encryptedFile?: EncryptedAttachment;
};
export type ChatRoom = {
  id: string;
  name: string;
  description: string;
  color: string;
  symbol: string;
  direct?: boolean;
  unread: number;
  members: { id: string; name: string }[];
  messages: Message[];
  encrypted?: boolean;
  invited?: boolean;
  hasOlder?: boolean;
  typing?: string[];
};
export type Account = {
  baseUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
};
