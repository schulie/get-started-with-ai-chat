import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";
import { ChatInput } from "./chatbot/ChatInput";
import { AgentPreviewChatBotProps, ChatDraft } from "./chatbot/types";
import { TaskStatus } from "./chatbot/TaskStatus";
import styles from "./AgentPreviewChatBot.module.css";
import clsx from "clsx";

export function AgentPreviewChatBot({ agentName, agentLogo, chatContext, draft }: AgentPreviewChatBotProps): React.JSX.Element {
  const [edit, setEdit] = useState<{ id: string; draft: ChatDraft }>();
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const messages = chatContext.messageList;
  const last = messages.at(-1);
  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  useEffect(() => { setEdit(undefined); }, [draft]);
  return (
    <div className={clsx(styles.chatContainer, messages.length === 0 && styles.emptyChatContainer)}>
      {messages.length > 0 && (
        <div className={styles.copilotChatContainer} ref={list} aria-label="Current session conversation"
          onScroll={() => {
            const element = list.current;
            if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          }}>
          {messages.map((message) => message.isAnswer ? (
            <AssistantMessage key={message.id} message={message} agentName={agentName} agentLogo={agentLogo}
              loadingState={message.id === last?.id && chatContext.isResponding ? "loading" : "none"}
              onRegenerate={message.id === last?.id && !chatContext.isResponding && message.status === "completed" ? chatContext.onRegenerate : undefined} />
          ) : (
            <UserMessage key={message.id} message={message} onEditMessage={(id) => {
              if (chatContext.isResponding) return;
              setEdit({ id, draft: { id: Date.now(), text: message.content } });
            }} />
          ))}
        </div>
      )}
      {chatContext.task && ["working", "writing"].includes(chatContext.task.phase) && <TaskStatus task={chatContext.task} />}
      {chatContext.error && <div role="alert" className={styles.errorPanel}>
        <span>{chatContext.error}</span>
        {chatContext.canRetry && <Button appearance="subtle" onClick={chatContext.onRetry}>Retry</Button>}
      </div>}
      {edit && <div className={styles.editNotice} role="status">
        Editing an earlier message. Sending starts a new branch from that point.
        <Button appearance="subtle" onClick={() => setEdit(undefined)}>Cancel edit</Button>
      </div>}
      <div className={styles.inputContainer}>
        <ChatInput key={edit?.id ?? "compose"} draft={edit?.draft ?? draft} isGenerating={chatContext.isResponding} onStop={chatContext.onStop}
          onSubmit={(text, options) => {
            follow.current = true;
            chatContext.onSend(text, edit?.id, options);
            setEdit(undefined);
          }} />
      </div>
    </div>
  );
}
