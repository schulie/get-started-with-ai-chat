/**
 * Common type definitions for chat components
 */

export interface IFileEntity {
  id: string;
  name: string;
  size: number;
  status?:
    | "pending"
    | "uploading"
    | "uploaded"
    | "error"
    | "deleting"
    | "processed";
  type: string;
  progress?: boolean;
  supportFileType?: string;
  createdDate?: number;
  originalFile?: File;
  uploadedId?: string;
  base64Url?: string;
  url?: string;
  error?: string;
  isRemote?: boolean;
}

export interface IChatItem {
  id: string;
  role?: string;
  content: string;
  isAnswer?: boolean;
  annotations?: any[];
  fileReferences?: Map<string, any>;
  duration?: number;
  status?: "working" | "writing" | "completed" | "stopped" | "failed";
  message_files?: IFileEntity[];
  usageInfo?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  more?: {
    time?: string;
  };
}

export interface ChatDraft {
  text: string;
  id: number;
}

export interface ChatInputProps {
  onSubmit: (message: string) => void;
  isGenerating: boolean;
  currentUserMessage?: string;
  onStop?: () => void;
  draft?: ChatDraft;
}

export interface IAssistantMessageProps {
  message: IChatItem;
  agentLogo?: string;
  agentName?: string;
  loadingState?: "loading" | "streaming" | "none";
  showUsageInfo?: boolean;
  onDelete?: (messageId: string) => Promise<void>;
  onRegenerate?: () => void;
}

export interface IUserMessageProps {
  message: IChatItem;
  onEditMessage: (messageId: string) => void;
}

export interface ChatContextType {
  messageList: IChatItem[];
  isResponding: boolean;
  onSend: (message: string, editingId?: string) => void;
  onStop?: () => void;
  onRetry?: () => void;
  onRegenerate?: () => void;
  error?: string;
  canRetry?: boolean;
  task?: import("./session").ChatTask;
}

export interface AgentPreviewChatBotProps {
  agentName?: string;
  agentLogo?: string;
  chatContext: ChatContextType;
  draft?: ChatDraft;
}
