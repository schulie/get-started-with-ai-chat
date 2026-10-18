import React, { useState, useMemo, useEffect, useRef } from "react";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";
import { ChatInput } from "./chatbot/ChatInput";
import { AgentPreviewChatBotProps } from "./chatbot/types";

import styles from "./AgentPreviewChatBot.module.css";
import clsx from "clsx";

export function AgentPreviewChatBot({
  agentName,
  agentLogo,
  chatContext,
}: AgentPreviewChatBotProps): React.JSX.Element {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (!chatContext.isResponding) {
      startTime.current = null;
      return;
    }
    startTime.current = Date.now();
    setElapsedSeconds(0);
    const interval = window.setInterval(() => {
      if (startTime.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [chatContext.isResponding]);

  const [currentUserMessage, setCurrentUserMessage] = useState<
    string | undefined
  >();

  const messageListFromChatContext = useMemo(
    () => chatContext.messageList ?? [],
    [chatContext.messageList]
  );

  const onEditMessage = (messageId: string) => {
    const selectedMessage = messageListFromChatContext.find(
      (message) => !message.isAnswer && message.id === messageId
    )?.content;
    setCurrentUserMessage(selectedMessage);
  };

  const isEmpty = messageListFromChatContext.length === 0;

  return (
    <div
      className={clsx(
        styles.chatContainer,
        isEmpty ? styles.emptyChatContainer : undefined
      )}
    >
      {!isEmpty ? (
        <div className={styles.copilotChatContainer}>
          {messageListFromChatContext.map((message, index, messageList) =>
            message.isAnswer ? (
              <AssistantMessage
                key={message.id}
                agentLogo={agentLogo}
                agentName={agentName}
                loadingState={
                  index === messageList.length - 1 && chatContext.isResponding
                    ? "loading"
                    : "none"
                }
                message={message}
              />
            ) : (
              <UserMessage
                key={message.id}
                message={message}
                onEditMessage={onEditMessage}
              />
            )
          )}
        </div>
      ) : (
        // Empty div needed for proper animation when transitioning to non-empty state
        <div />
      )}
      {chatContext.isResponding && (
        <div className={styles.taskStatus} role="status" aria-live="off">
          <span className={styles.taskStatusDot} aria-hidden="true" />
          <span>Generating response</span>
          <time className={styles.taskElapsed}>
            {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")} elapsed
          </time>
        </div>
      )}
      <div className={styles.inputContainer}>
        <ChatInput
          currentUserMessage={currentUserMessage}
          isGenerating={chatContext.isResponding}
          onSubmit={chatContext.onSend}
        />
      </div>
    </div>
  );
}
